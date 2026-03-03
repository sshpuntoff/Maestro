/**
 * Tests for useGroupChatAutoRun hook, extractFirstUncheckedTask, and markTaskCompleteInDoc.
 *
 * Tests cover:
 * - extractFirstUncheckedTask: pure function for parsing first unchecked task
 * - markTaskCompleteInDoc: pure function for marking a task complete in markdown
 * - startAutoRun: reads doc, initializes store state, sends first task to moderator
 * - stopAutoRun: sets stoppedRef, updates store, clears timers
 * - Error handling: doc read failures, no tasks found
 * - processNextTask: re-reads doc, extracts next task, sends to moderator
 * - Idle-state watcher: detects idle transitions, checks moderator signal, marks tasks, advances
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
	useGroupChatAutoRun,
	extractFirstUncheckedTask,
	markTaskCompleteInDoc,
} from '../../../../renderer/hooks/groupChat/useGroupChatAutoRun';
import { useGroupChatStore } from '../../../../renderer/stores/groupChatStore';

// ============================================================================
// Mocks
// ============================================================================

const mockReadDoc = vi.fn();
const mockWriteDoc = vi.fn();
const mockSendToModerator = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();

	// Reset the Zustand store
	useGroupChatStore.setState({
		groupChatAutoRunState: {
			isRunning: false,
			folderPath: null,
			selectedFile: null,
			totalTasks: 0,
			completedTasks: 0,
			currentTaskText: null,
			error: null,
		},
		groupChatState: 'idle',
		groupChatMessages: [],
	});

	// Mock window.maestro
	(window as any).maestro = {
		...(window as any).maestro,
		autorun: {
			readDoc: mockReadDoc,
			writeDoc: mockWriteDoc,
		},
		groupChat: {
			...(window as any).maestro?.groupChat,
			sendToModerator: mockSendToModerator,
		},
	};

	mockWriteDoc.mockResolvedValue({ success: true });
});

afterEach(() => {
	vi.useRealTimers();
});

// ============================================================================
// extractFirstUncheckedTask
// ============================================================================

describe('extractFirstUncheckedTask', () => {
	it('extracts the first unchecked task text', () => {
		const content = `# Tasks\n- [x] Done task\n- [ ] First unchecked task\n- [ ] Second unchecked task`;
		expect(extractFirstUncheckedTask(content)).toBe('First unchecked task');
	});

	it('returns null when no unchecked tasks remain', () => {
		const content = `# Tasks\n- [x] Done task\n- [X] Also done`;
		expect(extractFirstUncheckedTask(content)).toBeNull();
	});

	it('handles empty content', () => {
		expect(extractFirstUncheckedTask('')).toBeNull();
	});

	it('handles content with no checkboxes', () => {
		const content = `# Just a heading\nSome text`;
		expect(extractFirstUncheckedTask(content)).toBeNull();
	});

	it('handles asterisk-style checkboxes', () => {
		const content = `* [ ] Asterisk task`;
		expect(extractFirstUncheckedTask(content)).toBe('Asterisk task');
	});

	it('handles indented checkboxes', () => {
		const content = `  - [ ] Indented task`;
		expect(extractFirstUncheckedTask(content)).toBe('Indented task');
	});

	it('trims whitespace from extracted text', () => {
		const content = `- [ ]   Extra spaces task  `;
		expect(extractFirstUncheckedTask(content)).toBe('Extra spaces task');
	});

	it('skips checked tasks and finds first unchecked', () => {
		const content = [
			'- [x] Task 1',
			'- [X] Task 2',
			'- [ ] Task 3',
			'- [ ] Task 4',
		].join('\n');
		expect(extractFirstUncheckedTask(content)).toBe('Task 3');
	});

	it('handles bold task text', () => {
		const content = `- [ ] **Bold task description**`;
		expect(extractFirstUncheckedTask(content)).toBe('**Bold task description**');
	});
});

// ============================================================================
// markTaskCompleteInDoc
// ============================================================================

describe('markTaskCompleteInDoc', () => {
	it('marks the first matching unchecked task as complete', () => {
		const content = '- [ ] Task one\n- [ ] Task two';
		const result = markTaskCompleteInDoc(content, 'Task one');
		expect(result).toBe('- [x] Task one\n- [ ] Task two');
	});

	it('returns original content if task text not found', () => {
		const content = '- [ ] Task one\n- [ ] Task two';
		const result = markTaskCompleteInDoc(content, 'Nonexistent task');
		expect(result).toBe(content);
	});

	it('only marks the first matching task', () => {
		const content = '- [ ] Duplicate task\n- [ ] Duplicate task';
		const result = markTaskCompleteInDoc(content, 'Duplicate task');
		expect(result).toBe('- [x] Duplicate task\n- [ ] Duplicate task');
	});

	it('does not mark already-checked tasks', () => {
		const content = '- [x] Task one\n- [ ] Task two';
		const result = markTaskCompleteInDoc(content, 'Task one');
		// Task one is already checked, no unchecked match found for it
		expect(result).toBe(content);
	});

	it('handles asterisk-style checkboxes', () => {
		const content = '* [ ] Asterisk task';
		const result = markTaskCompleteInDoc(content, 'Asterisk task');
		expect(result).toBe('* [x] Asterisk task');
	});

	it('handles indented checkboxes', () => {
		const content = '  - [ ] Indented task';
		const result = markTaskCompleteInDoc(content, 'Indented task');
		expect(result).toBe('  - [x] Indented task');
	});

	it('preserves surrounding content', () => {
		const content = '# Header\n\n- [x] Done task\n- [ ] Target task\n- [ ] Other task\n\nFooter text';
		const result = markTaskCompleteInDoc(content, 'Target task');
		expect(result).toBe('# Header\n\n- [x] Done task\n- [x] Target task\n- [ ] Other task\n\nFooter text');
	});

	it('handles bold task text', () => {
		const content = '- [ ] **Bold task**';
		const result = markTaskCompleteInDoc(content, '**Bold task**');
		expect(result).toBe('- [x] **Bold task**');
	});

	it('trims task text for matching', () => {
		const content = '- [ ] Task with spaces';
		const result = markTaskCompleteInDoc(content, '  Task with spaces  ');
		expect(result).toBe('- [x] Task with spaces');
	});
});

// ============================================================================
// useGroupChatAutoRun — startAutoRun
// ============================================================================

describe('useGroupChatAutoRun', () => {
	describe('startAutoRun', () => {
		it('reads the document and initializes store state', async () => {
			const content = `- [ ] Task one\n- [ ] Task two\n- [x] Done task`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(true);
			expect(state.folderPath).toBe('/docs');
			expect(state.selectedFile).toBe('tasks.md');
			expect(state.totalTasks).toBe(3);
			expect(state.completedTasks).toBe(1);
			expect(state.error).toBeNull();
		});

		it('sends the first unchecked task to the moderator', async () => {
			const content = `- [x] Done\n- [ ] First open task\n- [ ] Second`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(mockSendToModerator).toHaveBeenCalledWith('gc-1', 'First open task', undefined, undefined, { isAutoRunTask: true });
			expect(useGroupChatStore.getState().groupChatAutoRunState.currentTaskText).toBe(
				'First open task'
			);
		});

		it('sets error when document read fails', async () => {
			mockReadDoc.mockResolvedValue({ success: false, error: 'File not found' });

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'missing.md');
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('File not found');
		});

		it('sets error when no unchecked tasks found', async () => {
			const content = `- [x] All done\n- [X] Also done`;
			mockReadDoc.mockResolvedValue({ success: true, content });

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('No unchecked tasks found in document');
		});

		it('reads doc with correct arguments', async () => {
			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task' });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/my/folder', 'autorun.md');
			});

			// First call is from startAutoRun, second from processNextTask
			expect(mockReadDoc).toHaveBeenCalledWith('/my/folder', 'autorun.md');
		});

		it('sets error on sendToModerator failure', async () => {
			const content = `- [ ] Task one`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockRejectedValue(new Error('IPC failure'));

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('IPC failure');
		});
	});

	// ==========================================================================
	// stopAutoRun
	// ==========================================================================

	describe('stopAutoRun', () => {
		it('stops the auto-run and updates store', async () => {
			const content = `- [ ] Task one\n- [ ] Task two`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(useGroupChatStore.getState().groupChatAutoRunState.isRunning).toBe(true);

			act(() => {
				result.current.stopAutoRun();
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.currentTaskText).toBeNull();
		});

		it('is idempotent — calling multiple times is safe', async () => {
			const { result } = renderHook(() => useGroupChatAutoRun());

			act(() => {
				result.current.stopAutoRun();
				result.current.stopAutoRun();
				result.current.stopAutoRun();
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
		});
	});

	// ==========================================================================
	// processNextTask (via run completion)
	// ==========================================================================

	describe('processNextTask', () => {
		it('marks run complete when all tasks are done on re-read', async () => {
			// First read (startAutoRun): has unchecked tasks
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Only task' })
				// Second read (processNextTask): all tasks now checked
				.mockResolvedValueOnce({ success: true, content: '- [x] Only task' });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.totalTasks).toBe(1);
			expect(state.completedTasks).toBe(1);
		});

		it('handles doc read failure during processNextTask', async () => {
			// First read succeeds
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Task one\n- [ ] Task two' })
				// Second read fails
				.mockResolvedValueOnce({ success: false, error: 'Disk error' });

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Disk error');
		});
	});

	// ==========================================================================
	// Idle-state watcher
	// ==========================================================================

	describe('idle-state watcher', () => {
		/**
		 * Set up a running Auto-Run with a pending task.
		 * Must be called BEFORE enabling fake timers.
		 * Returns the renderHook result.
		 */
		async function setupRunningState() {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// Verify expected state
			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(true);
			expect(state.currentTaskText).toBe('Task one');

			// Reset mocks for clean test assertions
			mockReadDoc.mockReset();
			mockSendToModerator.mockReset();
			mockWriteDoc.mockReset();

			return hook;
		}

		/**
		 * Trigger a non-idle → idle transition on the store.
		 * With fake timers active, flush microtasks via advanceTimersByTimeAsync.
		 */
		async function triggerIdleTransition() {
			useGroupChatStore.setState({ groupChatState: 'moderator-thinking' });
			useGroupChatStore.setState({ groupChatState: 'idle' });
			// Flush microtasks so handleIdleAdvancement resolves
			await vi.advanceTimersByTimeAsync(0);
		}

		it('detects idle transition and marks task complete when moderator signals success', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });
			mockWriteDoc.mockResolvedValue({ success: true });

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:00:00Z', from: 'user', content: 'Task one' },
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Delegated to agent and verified.' },
				],
			});

			await triggerIdleTransition();

			expect(mockReadDoc).toHaveBeenCalledWith('/docs', 'tasks.md');
			expect(mockWriteDoc).toHaveBeenCalledWith(
				'/docs',
				'tasks.md',
				'- [x] Task one\n- [ ] Task two'
			);

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.currentTaskText).toBeNull();
			expect(state.completedTasks).toBe(1);
			expect(state.totalTasks).toBe(2);

			hook.unmount();
		});

		it('advances to next task after 500ms delay', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			const docContent = '- [ ] Task one\n- [ ] Task two';
			const markedContent = '- [x] Task one\n- [ ] Task two';
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: docContent })   // idle advancement read
				.mockResolvedValueOnce({ success: true, content: markedContent }); // processNextTask read after delay
			mockWriteDoc.mockResolvedValue({ success: true });
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			await triggerIdleTransition();

			// processNextTask should NOT have been called yet (500ms delay pending)
			expect(mockSendToModerator).not.toHaveBeenCalled();

			// Advance timer by 500ms to trigger processNextTask
			await vi.advanceTimersByTimeAsync(500);

			// Now processNextTask should have fired and sent the next task
			expect(mockSendToModerator).toHaveBeenCalledWith(
				'gc-1',
				'Task two',
				undefined,
				undefined,
				{ isAutoRunTask: true }
			);

			hook.unmount();
		});

		it('does not mark checkbox when moderator signals task incomplete', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task incomplete: Agent could not resolve the issue.' },
				],
			});

			await triggerIdleTransition();

			// writeDoc should NOT have been called (task incomplete)
			expect(mockWriteDoc).not.toHaveBeenCalled();

			// currentTaskText should still be cleared
			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.currentTaskText).toBeNull();

			hook.unmount();
		});

		it('does not trigger when state is already idle (no transition)', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one' });

			// State was already idle — setting to idle again is not a transition
			useGroupChatStore.setState({ groupChatState: 'idle' });
			await vi.advanceTimersByTimeAsync(0);

			// readDoc should NOT have been called by the idle watcher
			expect(mockReadDoc).not.toHaveBeenCalled();

			hook.unmount();
		});

		it('does not trigger when Auto-Run is not running', async () => {
			const hook = await setupRunningState();

			// Stop the auto-run
			act(() => {
				hook.result.current.stopAutoRun();
			});

			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one' });

			// Trigger idle transition
			useGroupChatStore.setState({ groupChatState: 'moderator-thinking' });
			useGroupChatStore.setState({ groupChatState: 'idle' });
			await vi.advanceTimersByTimeAsync(0);

			// readDoc should NOT have been called (stopped)
			expect(mockReadDoc).not.toHaveBeenCalled();

			hook.unmount();
		});

		it('does not trigger when no currentTaskText is set', async () => {
			const hook = renderHook(() => useGroupChatAutoRun());
			vi.useFakeTimers();

			// Set running state but without currentTaskText
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/docs',
					selectedFile: 'tasks.md',
					totalTasks: 2,
					completedTasks: 0,
					currentTaskText: null,
					error: null,
				},
			});

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one' });

			useGroupChatStore.setState({ groupChatState: 'moderator-thinking' });
			useGroupChatStore.setState({ groupChatState: 'idle' });
			await vi.advanceTimersByTimeAsync(0);

			expect(mockReadDoc).not.toHaveBeenCalled();

			hook.unmount();
		});

		it('handles doc read failure during idle advancement', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: false, error: 'Permission denied' });

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			await triggerIdleTransition();

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Permission denied');
			expect(state.currentTaskText).toBeNull();

			hook.unmount();
		});

		it('does not advance when stopped during 500ms delay', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });
			mockWriteDoc.mockResolvedValue({ success: true });

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			await triggerIdleTransition();

			// Stop before the 500ms timer fires
			act(() => {
				hook.result.current.stopAutoRun();
			});

			mockSendToModerator.mockResolvedValue(undefined);

			// Advance timer — processNextTask should NOT fire because we stopped
			await vi.advanceTimersByTimeAsync(500);

			expect(mockSendToModerator).not.toHaveBeenCalled();

			hook.unmount();
		});

		it('still advances to next task when moderator gives no completion signal', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			const docContent = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: docContent })   // idle advancement read
				.mockResolvedValueOnce({ success: true, content: docContent });   // processNextTask read (same content, Task one still unchecked)
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'I delegated the task but it was not resolved.' },
				],
			});

			await triggerIdleTransition();

			// Should NOT have written the doc
			expect(mockWriteDoc).not.toHaveBeenCalled();

			// Should still advance after delay
			await vi.advanceTimersByTimeAsync(500);

			expect(mockSendToModerator).toHaveBeenCalled();

			hook.unmount();
		});

		it('handles empty moderator messages gracefully', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });

			// No moderator messages — only user messages
			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:00:00Z', from: 'user', content: 'Task one' },
				],
			});

			await triggerIdleTransition();

			// Should not have written doc (no moderator message = no completion signal)
			expect(mockWriteDoc).not.toHaveBeenCalled();

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.currentTaskText).toBeNull();

			hook.unmount();
		});

		it('cleans up subscription and timer on unmount', async () => {
			const hook = await setupRunningState();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });
			mockWriteDoc.mockResolvedValue({ success: true });

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			// Trigger idle transition (starts the 500ms timer)
			await triggerIdleTransition();

			// Unmount before the timer fires
			hook.unmount();

			mockReadDoc.mockReset();
			mockSendToModerator.mockResolvedValue(undefined);

			// Advance timer — should NOT trigger processNextTask since unmounted
			await vi.advanceTimersByTimeAsync(500);

			expect(mockReadDoc).not.toHaveBeenCalled();
		});
	});
});
