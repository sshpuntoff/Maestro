/**
 * useGroupChatAutoRun — drives sequential Auto-Run execution for group chats.
 *
 * Exposes `startAutoRun(groupChatId, folderPath, filename)` and `stopAutoRun()`.
 * Reads a markdown task document, extracts the first unchecked `- [ ]` task,
 * and sends it to the group chat moderator via `sendToModerator`. The idle-state
 * watcher (Phase 2 follow-up) advances to the next task when the cycle completes.
 */

import { useCallback, useRef } from 'react';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { countUnfinishedTasks, countCheckedTasks } from '../batch/batchUtils';

// Regex to find the first unchecked markdown checkbox and extract its text.
// Matches: - [ ] task text  or  * [ ] task text (with optional leading whitespace)
const FIRST_UNCHECKED_REGEX = /^[\s]*[-*]\s*\[\s*\]\s*(.+)$/m;

/**
 * Extract the text of the first unchecked task from markdown content.
 * Returns null if no unchecked tasks remain.
 */
export function extractFirstUncheckedTask(content: string): string | null {
	const match = content.match(FIRST_UNCHECKED_REGEX);
	return match ? match[1].trim() : null;
}

export interface UseGroupChatAutoRunReturn {
	startAutoRun: (groupChatId: string, folderPath: string, filename: string) => Promise<void>;
	stopAutoRun: () => void;
}

export function useGroupChatAutoRun(): UseGroupChatAutoRunReturn {
	const stoppedRef = useRef(false);

	/**
	 * Process the next unchecked task from the document.
	 * Re-reads the document each time to get the latest state.
	 */
	const processNextTask = useCallback(async (groupChatId: string, folderPath: string, filename: string) => {
		if (stoppedRef.current) return;

		const { setGroupChatAutoRunState } = useGroupChatStore.getState();

		// Re-read document to get current state
		const result = await window.maestro.autorun.readDoc(folderPath, filename);
		if (!result.success || !result.content) {
			setGroupChatAutoRunState({
				isRunning: false,
				error: result.error || 'Failed to read document',
				currentTaskText: null,
			});
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

		// Send task to moderator via existing IPC path.
		// Note: `isAutoRunTask` flag will be wired in Phase 2 follow-up task.
		await window.maestro.groupChat.sendToModerator(groupChatId, taskText);
	}, []);

	/**
	 * Start Auto-Run: read the document, count tasks, and kick off the first task.
	 */
	const startAutoRun = useCallback(async (groupChatId: string, folderPath: string, filename: string) => {
		const { setGroupChatAutoRunState } = useGroupChatStore.getState();

		stoppedRef.current = false;

		// Read the document
		const result = await window.maestro.autorun.readDoc(folderPath, filename);
		if (!result.success || !result.content) {
			setGroupChatAutoRunState({
				isRunning: false,
				error: result.error || 'Failed to read document',
			});
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

		// Kick off first task
		try {
			await processNextTask(groupChatId, folderPath, filename);
		} catch (err) {
			if (stoppedRef.current) return;
			setGroupChatAutoRunState({
				isRunning: false,
				error: err instanceof Error ? err.message : 'Failed to start Auto-Run',
				currentTaskText: null,
			});
		}
	}, [processNextTask]);

	/**
	 * Stop Auto-Run gracefully.
	 */
	const stopAutoRun = useCallback(() => {
		stoppedRef.current = true;
		const { setGroupChatAutoRunState } = useGroupChatStore.getState();
		setGroupChatAutoRunState({
			isRunning: false,
			currentTaskText: null,
		});
	}, []);

	return { startAutoRun, stopAutoRun };
}
