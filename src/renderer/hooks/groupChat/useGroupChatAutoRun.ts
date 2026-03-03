/**
 * useGroupChatAutoRun — drives sequential Auto-Run execution for group chats.
 *
 * Exposes `startAutoRun(groupChatId, folderPath, filename)` and `stopAutoRun()`.
 * Reads a markdown task document, extracts the first unchecked `- [ ]` task,
 * and sends it to the group chat moderator via `sendToModerator`. The idle-state
 * watcher advances to the next task when the moderator cycle completes (idle).
 */

import { useCallback, useRef, useEffect } from 'react';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { notifyToast } from '../../stores/notificationStore';
import { countUnfinishedTasks, countCheckedTasks } from '../batch/batchUtils';
import type { GroupChatMessage } from '../../types';

// Regex to find the first unchecked markdown checkbox and extract its text.
// Matches: - [ ] task text  or  * [ ] task text (with optional leading whitespace)
const FIRST_UNCHECKED_REGEX = /^[\s]*[-*]\s*\[\s*\]\s*(.+)$/m;

// Delay between task completion and next task processing (ms)
const TASK_ADVANCE_DELAY_MS = 500;

// Power management reason identifier for preventing system sleep
const POWER_REASON = 'groupchat-autorun';

// Timeout (ms) — stop Auto-Run if no progress after 10 minutes
const AUTORUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Extract the text of the first unchecked task from markdown content.
 * Returns null if no unchecked tasks remain.
 */
export function extractFirstUncheckedTask(content: string): string | null {
	const match = content.match(FIRST_UNCHECKED_REGEX);
	return match ? match[1].trim() : null;
}

/**
 * Mark a specific task as complete in a markdown document.
 * Finds the first unchecked checkbox whose text matches taskText and replaces
 * `- [ ]` (or `* [ ]`) with `- [x]` (or `* [x]`).
 * Returns the updated content, or the original content if no match found.
 */
export function markTaskCompleteInDoc(content: string, taskText: string): string {
	const lines = content.split('\n');
	const normalizedTaskText = taskText.trim();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Match unchecked checkbox: optional whitespace, - or *, [ ], then task text
		const match = line.match(/^(\s*[-*]\s*)\[\s*\](\s+)(.+)$/);
		if (match && match[3].trim() === normalizedTaskText) {
			lines[i] = `${match[1]}[x]${match[2]}${match[3]}`;
			break; // Only mark the first matching task
		}
	}

	return lines.join('\n');
}

/**
 * Find the last message from the moderator in the group chat messages.
 * Returns the message content, or null if no moderator messages found.
 */
function findLastModeratorMessage(messages: GroupChatMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].from === 'moderator') {
			return messages[i].content;
		}
	}
	return null;
}

export interface UseGroupChatAutoRunReturn {
	startAutoRun: (groupChatId: string, folderPath: string, filename: string) => Promise<void>;
	stopAutoRun: () => void;
}

export function useGroupChatAutoRun(): UseGroupChatAutoRunReturn {
	const stoppedRef = useRef(false);
	const groupChatIdRef = useRef<string | null>(null);
	const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastProgressTimestampRef = useRef<number>(0);
	const timeoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	/**
	 * Remove the power management lock. Safe to call multiple times.
	 */
	const removePowerLock = useCallback(() => {
		window.maestro.power.removeReason(POWER_REASON).catch(() => {});
	}, []);

	/**
	 * Stop the timeout checker interval.
	 */
	const stopTimeoutChecker = useCallback(() => {
		if (timeoutTimerRef.current) {
			clearInterval(timeoutTimerRef.current);
			timeoutTimerRef.current = null;
		}
	}, []);

	/**
	 * Start a periodic timeout checker that stops Auto-Run if no progress
	 * has been made within AUTORUN_TIMEOUT_MS.
	 */
	const startTimeoutChecker = useCallback(() => {
		stopTimeoutChecker();
		lastProgressTimestampRef.current = Date.now();
		timeoutTimerRef.current = setInterval(() => {
			if (stoppedRef.current) {
				stopTimeoutChecker();
				return;
			}
			const elapsed = Date.now() - lastProgressTimestampRef.current;
			if (elapsed >= AUTORUN_TIMEOUT_MS) {
				// Timeout — stop Auto-Run
				stoppedRef.current = true;
				if (advanceTimerRef.current) {
					clearTimeout(advanceTimerRef.current);
					advanceTimerRef.current = null;
				}
				stopTimeoutChecker();
				removePowerLock();
				const { setGroupChatAutoRunState } = useGroupChatStore.getState();
				setGroupChatAutoRunState({
					isRunning: false,
					error: 'Auto Run timed out after 10 minutes with no progress',
					currentTaskText: null,
				});
				notifyToast({
					type: 'error',
					title: 'Group Chat Auto Run Timeout',
					message: 'Auto Run timed out after 10 minutes with no progress',
				});
			}
		}, 30_000); // Check every 30 seconds
	}, [removePowerLock, stopTimeoutChecker]);

	/**
	 * Process the next unchecked task from the document.
	 * Re-reads the document each time to get the latest state.
	 */
	const processNextTask = useCallback(async (groupChatId: string, folderPath: string, filename: string) => {
		if (stoppedRef.current) return;

		const { setGroupChatAutoRunState } = useGroupChatStore.getState();

		// Re-read document to get current state
		let result;
		try {
			result = await window.maestro.autorun.readDoc(folderPath, filename);
		} catch (err) {
			if (stoppedRef.current) return;
			const message = err instanceof Error ? err.message : 'Failed to read document';
			setGroupChatAutoRunState({ isRunning: false, error: message, currentTaskText: null });
			removePowerLock();
			stopTimeoutChecker();
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
			return;
		}
		if (!result.success || !result.content) {
			if (stoppedRef.current) return;
			const message = result.error || 'Failed to read document';
			setGroupChatAutoRunState({ isRunning: false, error: message, currentTaskText: null });
			removePowerLock();
			stopTimeoutChecker();
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
			return;
		}

		const content = result.content;
		const taskText = extractFirstUncheckedTask(content);

		if (!taskText) {
			// No unchecked tasks remain — run is complete
			const total = countCheckedTasks(content) + countUnfinishedTasks(content);
			const completed = countCheckedTasks(content);
			setGroupChatAutoRunState({
				isRunning: false,
				currentTaskText: null,
				totalTasks: total,
				completedTasks: completed,
			});
			removePowerLock();
			stopTimeoutChecker();
			return;
		}

		if (stoppedRef.current) return;

		// Update store with current task
		const total = countCheckedTasks(content) + countUnfinishedTasks(content);
		const completed = countCheckedTasks(content);
		setGroupChatAutoRunState({
			currentTaskText: taskText,
			totalTasks: total,
			completedTasks: completed,
		});

		// Send task to moderator with Auto-Run flag so router uses Auto-Run prompts
		try {
			await window.maestro.groupChat.sendToModerator(groupChatId, taskText, undefined, undefined, { isAutoRunTask: true });
			// Update progress timestamp on successful task send
			lastProgressTimestampRef.current = Date.now();
		} catch (err) {
			if (stoppedRef.current) return;
			const message = err instanceof Error ? err.message : 'Failed to send task to moderator';
			setGroupChatAutoRunState({ isRunning: false, error: message, currentTaskText: null });
			removePowerLock();
			stopTimeoutChecker();
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
		}
	}, [removePowerLock, stopTimeoutChecker]);

	/**
	 * Handle the idle-state transition for task advancement.
	 * Called when groupChatState transitions to 'idle' while Auto-Run is active.
	 */
	const handleIdleAdvancement = useCallback(async () => {
		if (stoppedRef.current) return;

		const { groupChatAutoRunState, groupChatMessages, setGroupChatAutoRunState } =
			useGroupChatStore.getState();
		const { currentTaskText } = groupChatAutoRunState;
		const groupChatId = groupChatIdRef.current;
		const folderPath = groupChatAutoRunState.folderPath;
		const selectedFile = groupChatAutoRunState.selectedFile;

		if (!groupChatId || !folderPath || !selectedFile || !currentTaskText) return;
		if (stoppedRef.current) return;

		try {
			// (1) Re-read the document
			const result = await window.maestro.autorun.readDoc(folderPath, selectedFile);
			if (!result.success || !result.content) {
				if (stoppedRef.current) return;
				const message = result.error || 'Failed to read document during advancement';
				setGroupChatAutoRunState({ isRunning: false, error: message, currentTaskText: null });
				removePowerLock();
				stopTimeoutChecker();
				notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
				return;
			}

			if (stoppedRef.current) return;

			// (2) Check last moderator message for "Task complete" signal
			const lastModMessage = findLastModeratorMessage(groupChatMessages);
			const isComplete = lastModMessage?.trim().toLowerCase().startsWith('task complete:') ?? false;

			// (3) If complete, mark the task in the doc and write back
			if (isComplete) {
				const updatedContent = markTaskCompleteInDoc(result.content, currentTaskText);

				if (updatedContent !== result.content) {
					await window.maestro.autorun.writeDoc(folderPath, selectedFile, updatedContent);
				}

				// (4) Update store — re-count from updated content
				const newChecked = countCheckedTasks(updatedContent);
				const newTotal = newChecked + countUnfinishedTasks(updatedContent);
				setGroupChatAutoRunState({
					completedTasks: newChecked,
					totalTasks: newTotal,
					currentTaskText: null,
				});

				// Update progress timestamp — task was completed
				lastProgressTimestampRef.current = Date.now();
			} else {
				// Task incomplete — clear task text but don't increment completed count
				setGroupChatAutoRunState({
					currentTaskText: null,
				});
			}

			if (stoppedRef.current) return;

			// (5) After 500ms delay, advance to the next task
			advanceTimerRef.current = setTimeout(() => {
				advanceTimerRef.current = null;
				if (stoppedRef.current) return;
				processNextTask(groupChatId, folderPath, selectedFile);
			}, TASK_ADVANCE_DELAY_MS);
		} catch (err) {
			if (stoppedRef.current) return;
			const message = err instanceof Error ? err.message : 'Auto Run task advancement failed';
			setGroupChatAutoRunState({ isRunning: false, error: message, currentTaskText: null });
			removePowerLock();
			stopTimeoutChecker();
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
		}
	}, [processNextTask, removePowerLock, stopTimeoutChecker]);

	/**
	 * Idle-state watcher: subscribes to store and detects transitions to 'idle'.
	 * When Auto-Run is active and a task is pending, triggers task advancement.
	 */
	useEffect(() => {
		let previousState = useGroupChatStore.getState().groupChatState;

		const unsubscribe = useGroupChatStore.subscribe((state) => {
			const currentState = state.groupChatState;
			const wasNotIdle = previousState !== 'idle';
			previousState = currentState;

			// Only trigger on transition TO idle (not if already idle)
			if (currentState !== 'idle' || !wasNotIdle) return;

			// Only advance if Auto-Run is active with a pending task
			if (!state.groupChatAutoRunState.isRunning) return;
			if (!state.groupChatAutoRunState.currentTaskText) return;
			if (stoppedRef.current) return;

			handleIdleAdvancement();
		});

		return () => {
			unsubscribe();
			if (advanceTimerRef.current) {
				clearTimeout(advanceTimerRef.current);
				advanceTimerRef.current = null;
			}
		};
	}, [handleIdleAdvancement]);

	/**
	 * Group chat error watcher: if groupChatError is set while Auto-Run is active,
	 * stop gracefully and surface the error in the Auto-Run state.
	 */
	useEffect(() => {
		const unsubscribe = useGroupChatStore.subscribe((state, prevState) => {
			// Only react to new errors (null → non-null transition)
			if (!state.groupChatError || prevState.groupChatError === state.groupChatError) return;
			if (!state.groupChatAutoRunState.isRunning) return;
			if (stoppedRef.current) return;

			// Stop Auto-Run gracefully
			stoppedRef.current = true;
			if (advanceTimerRef.current) {
				clearTimeout(advanceTimerRef.current);
				advanceTimerRef.current = null;
			}
			removePowerLock();
			stopTimeoutChecker();

			const errorMessage = state.groupChatError.error?.message || 'Group chat error during Auto Run';
			state.setGroupChatAutoRunState({
				isRunning: false,
				error: errorMessage,
				currentTaskText: null,
			});
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Stopped', message: errorMessage });
		});

		return () => {
			unsubscribe();
		};
	}, [removePowerLock, stopTimeoutChecker]);

	/**
	 * Active group chat change watcher: if the user switches to a different
	 * group chat (or closes it) while Auto-Run is active, stop gracefully.
	 */
	useEffect(() => {
		const unsubscribe = useGroupChatStore.subscribe((state, prevState) => {
			// Only react when activeGroupChatId actually changes
			if (state.activeGroupChatId === prevState.activeGroupChatId) return;
			if (!state.groupChatAutoRunState.isRunning) return;
			if (stoppedRef.current) return;

			// Stop Auto-Run gracefully — chat context has changed
			stoppedRef.current = true;
			if (advanceTimerRef.current) {
				clearTimeout(advanceTimerRef.current);
				advanceTimerRef.current = null;
			}
			removePowerLock();
			stopTimeoutChecker();

			state.setGroupChatAutoRunState({
				isRunning: false,
				error: 'Auto Run stopped: group chat was closed or switched',
				currentTaskText: null,
			});
			notifyToast({
				type: 'warning',
				title: 'Group Chat Auto Run Stopped',
				message: 'Auto Run stopped because the group chat was closed or switched',
			});
		});

		return () => {
			unsubscribe();
		};
	}, [removePowerLock, stopTimeoutChecker]);

	/**
	 * Start Auto-Run: read the document, count tasks, and kick off the first task.
	 */
	const startAutoRun = useCallback(async (groupChatId: string, folderPath: string, filename: string) => {
		const { setGroupChatAutoRunState } = useGroupChatStore.getState();

		stoppedRef.current = false;
		groupChatIdRef.current = groupChatId;

		// Read the document
		let result;
		try {
			result = await window.maestro.autorun.readDoc(folderPath, filename);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to read document';
			setGroupChatAutoRunState({ isRunning: false, error: message });
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
			return;
		}
		if (!result.success || !result.content) {
			const message = result.error || 'Failed to read document';
			setGroupChatAutoRunState({ isRunning: false, error: message });
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
			return;
		}

		const content = result.content;
		const unfinished = countUnfinishedTasks(content);
		const checked = countCheckedTasks(content);
		const total = unfinished + checked;

		if (unfinished === 0) {
			setGroupChatAutoRunState({
				isRunning: false,
				error: 'No unchecked tasks found in document',
			});
			return;
		}

		// Initialize Auto-Run state
		setGroupChatAutoRunState({
			isRunning: true,
			folderPath,
			selectedFile: filename,
			totalTasks: total,
			completedTasks: checked,
			currentTaskText: null,
			error: null,
		});

		// Prevent system sleep while Auto-Run is active
		window.maestro.power.addReason(POWER_REASON).catch(() => {});

		// Start timeout checker
		startTimeoutChecker();

		// Kick off first task
		try {
			await processNextTask(groupChatId, folderPath, filename);
		} catch (err) {
			if (stoppedRef.current) return;
			const message = err instanceof Error ? err.message : 'Failed to start Auto-Run';
			setGroupChatAutoRunState({ isRunning: false, error: message, currentTaskText: null });
			removePowerLock();
			stopTimeoutChecker();
			notifyToast({ type: 'error', title: 'Group Chat Auto Run Error', message });
		}
	}, [processNextTask, removePowerLock, startTimeoutChecker, stopTimeoutChecker]);

	/**
	 * Stop Auto-Run gracefully.
	 */
	const stopAutoRun = useCallback(() => {
		stoppedRef.current = true;
		if (advanceTimerRef.current) {
			clearTimeout(advanceTimerRef.current);
			advanceTimerRef.current = null;
		}
		removePowerLock();
		stopTimeoutChecker();
		const { setGroupChatAutoRunState } = useGroupChatStore.getState();
		setGroupChatAutoRunState({
			isRunning: false,
			currentTaskText: null,
		});
	}, [removePowerLock, stopTimeoutChecker]);

	/**
	 * Cleanup: remove power lock and stop timeout checker on unmount.
	 * Ensures system sleep is not blocked if the component unmounts
	 * while Auto-Run is still active.
	 */
	useEffect(() => {
		return () => {
			removePowerLock();
			stopTimeoutChecker();
		};
	}, [removePowerLock, stopTimeoutChecker]);

	return { startAutoRun, stopAutoRun };
}
