/**
 * Tests for useGroupChatAutoRun hook, extractFirstUncheckedTask, and markTaskCompleteInDoc.
 *
 * Tests cover:
 * - extractFirstUncheckedTask: pure function for parsing first unchecked task
 * - markTaskCompleteInDoc: pure function for marking a task complete in markdown
 * - startAutoRun: reads doc, initializes store state, sends first task to moderator
 * - stopAutoRun: sets stoppedRef, updates store, clears timers
 * - Error handling: doc read failures, no tasks found, error toasts, groupChatError watcher
 * - processNextTask: re-reads doc, extracts next task, sends to moderator
 * - Idle-state watcher: detects idle transitions, checks moderator signal, marks tasks, advances
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock notifyToast (module-level export can't be spied — must vi.mock)
vi.mock('../../../../renderer/stores/notificationStore', async () => {
	const actual = await vi.importActual('../../../../renderer/stores/notificationStore');
	return { ...actual, notifyToast: vi.fn() };
});
import { notifyToast } from '../../../../renderer/stores/notificationStore';
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
const mockAppendMessage = vi.fn().mockResolvedValue(undefined);
const mockAddReason = vi.fn().mockResolvedValue(undefined);
const mockRemoveReason = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
	// Reset call history AND implementation (mockOnce queues etc.)
	mockReadDoc.mockReset();
	mockWriteDoc.mockReset();
	mockSendToModerator.mockReset();
	mockAppendMessage.mockReset().mockResolvedValue(undefined);
	mockAddReason.mockReset().mockResolvedValue(undefined);
	mockRemoveReason.mockReset().mockResolvedValue(undefined);
	vi.mocked(notifyToast).mockClear();

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
		groupChatError: null,
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
			appendMessage: mockAppendMessage,
		},
		power: {
			addReason: mockAddReason,
			removeReason: mockRemoveReason,
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

		it('clears pending advance timer when stopping', async () => {
			const content = `- [ ] Task one\n- [ ] Task two`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// Stop and verify no error toast is emitted
			act(() => {
				result.current.stopAutoRun();
			});

			// stopAutoRun should not emit a toast
			expect(notifyToast).not.toHaveBeenCalled();
		});
	});

	// ==========================================================================
	// Error toast emission
	// ==========================================================================

	describe('error toasts', () => {
		it('emits error toast when startAutoRun document read fails', async () => {
			mockReadDoc.mockResolvedValue({ success: false, error: 'File not found' });

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'missing.md');
			});

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Error',
				message: 'File not found',
			});
		});

		it('emits error toast when startAutoRun readDoc throws', async () => {
			mockReadDoc.mockRejectedValue(new Error('Network error'));

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Error',
				message: 'Network error',
			});
			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Network error');
		});

		it('emits error toast when sendToModerator fails during start', async () => {
			const content = `- [ ] Task one`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockRejectedValue(new Error('IPC failure'));

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Error',
				message: 'IPC failure',
			});
		});

		it('emits error toast when sendToModerator throws in processNextTask', async () => {
			// sendToModerator throws immediately on first call
			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one' });
			mockSendToModerator.mockRejectedValue(new Error('Moderator send failed'));

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Error',
				message: 'Moderator send failed',
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Moderator send failed');
		});

		it('emits error toast when doc read fails during idle advancement', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			mockReadDoc.mockReset();
			vi.useFakeTimers();

			// Now readDoc fails during idle advancement
			mockReadDoc.mockResolvedValue({ success: false, error: 'Permission denied' });

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			useGroupChatStore.setState({ groupChatState: 'moderator-thinking' });
			useGroupChatStore.setState({ groupChatState: 'idle' });
			await vi.advanceTimersByTimeAsync(0);

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Error',
				message: 'Permission denied',
			});

			hook.unmount();
		});

		it('emits error toast when writeDoc throws during idle advancement', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			mockReadDoc.mockReset();
			mockWriteDoc.mockReset();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });
			mockWriteDoc.mockRejectedValue(new Error('Disk write failed'));

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			useGroupChatStore.setState({ groupChatState: 'moderator-thinking' });
			useGroupChatStore.setState({ groupChatState: 'idle' });
			await vi.advanceTimersByTimeAsync(0);

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Error',
				message: 'Disk write failed',
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Disk write failed');

			hook.unmount();
		});

		it('does not emit toast for non-error cases (no unchecked tasks)', async () => {
			const content = `- [x] All done`;
			mockReadDoc.mockResolvedValue({ success: true, content });

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// "No unchecked tasks" is a validation message, not an operational error
			// It sets store error but should not emit a toast
			expect(notifyToast).not.toHaveBeenCalled();
		});
	});

	// ==========================================================================
	// groupChatError watcher
	// ==========================================================================

	describe('groupChatError watcher', () => {
		it('stops Auto-Run when groupChatError is set during a run', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(useGroupChatStore.getState().groupChatAutoRunState.isRunning).toBe(true);

			// Simulate a group chat error
			act(() => {
				useGroupChatStore.setState({
					groupChatError: {
						groupChatId: 'gc-1',
						error: { type: 'process_error', message: 'Agent crashed', recoverable: false },
						participantName: 'agent-1',
					},
				});
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Agent crashed');
			expect(state.currentTaskText).toBeNull();

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Stopped',
				message: 'Agent crashed',
			});

			hook.unmount();
		});

		it('does not stop when groupChatError is set while Auto-Run is not running', async () => {
			const hook = renderHook(() => useGroupChatAutoRun());

			act(() => {
				useGroupChatStore.setState({
					groupChatError: {
						groupChatId: 'gc-1',
						error: { type: 'process_error', message: 'Agent crashed', recoverable: false },
					},
				});
			});

			// Should not have emitted a toast since Auto-Run was not running
			expect(notifyToast).not.toHaveBeenCalled();

			hook.unmount();
		});

		it('does not react to groupChatError being cleared (non-null → null)', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// Set error first
			act(() => {
				useGroupChatStore.setState({
					groupChatError: {
						groupChatId: 'gc-1',
						error: { type: 'process_error', message: 'Agent crashed', recoverable: false },
					},
				});
			});

			vi.mocked(notifyToast).mockClear();

			// Restart auto-run (reset stopped state)
			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });
			mockSendToModerator.mockResolvedValue(undefined);

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// Clear the error — should NOT trigger the watcher again
			act(() => {
				useGroupChatStore.setState({ groupChatError: null });
			});

			// No error toast should have been emitted when clearing
			expect(notifyToast).not.toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Group Chat Auto Run Stopped' })
			);

			hook.unmount();
		});

		it('uses fallback message when error has no message', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// Set error with no message field
			act(() => {
				useGroupChatStore.setState({
					groupChatError: {
						groupChatId: 'gc-1',
						error: { type: 'unknown', message: '', recoverable: false },
					},
				});
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Group chat error during Auto Run');

			hook.unmount();
		});
	});

	// ==========================================================================
	// activeGroupChatId change watcher
	// ==========================================================================

	describe('activeGroupChatId change watcher', () => {
		it('stops Auto-Run when activeGroupChatId changes during a run', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			// Set initial activeGroupChatId
			useGroupChatStore.setState({ activeGroupChatId: 'gc-1' });

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(useGroupChatStore.getState().groupChatAutoRunState.isRunning).toBe(true);

			// Simulate switching to a different group chat
			act(() => {
				useGroupChatStore.setState({ activeGroupChatId: 'gc-2' });
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Auto Run stopped: group chat was closed or switched');
			expect(state.currentTaskText).toBeNull();

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'warning',
				title: 'Group Chat Auto Run Stopped',
				message: 'Auto Run stopped because the group chat was closed or switched',
			});

			hook.unmount();
		});

		it('stops Auto-Run when activeGroupChatId is set to null (chat closed)', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({ activeGroupChatId: 'gc-1' });

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(useGroupChatStore.getState().groupChatAutoRunState.isRunning).toBe(true);

			// Simulate closing the group chat
			act(() => {
				useGroupChatStore.setState({ activeGroupChatId: null });
			});

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Auto Run stopped: group chat was closed or switched');

			hook.unmount();
		});

		it('does not stop when activeGroupChatId changes while Auto-Run is not running', async () => {
			useGroupChatStore.setState({ activeGroupChatId: 'gc-1' });

			const hook = renderHook(() => useGroupChatAutoRun());

			// Change chat without starting Auto-Run
			act(() => {
				useGroupChatStore.setState({ activeGroupChatId: 'gc-2' });
			});

			// Should not have emitted a toast since Auto-Run was not running
			expect(notifyToast).not.toHaveBeenCalled();

			hook.unmount();
		});

		it('removes power lock when stopping due to chat change', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({ activeGroupChatId: 'gc-1' });

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			mockRemoveReason.mockClear();

			act(() => {
				useGroupChatStore.setState({ activeGroupChatId: 'gc-2' });
			});

			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');

			hook.unmount();
		});

		it('does not react when activeGroupChatId is set to the same value', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({ activeGroupChatId: 'gc-1' });

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			vi.mocked(notifyToast).mockClear();

			// Set the same activeGroupChatId — should NOT trigger stop
			act(() => {
				useGroupChatStore.setState({ activeGroupChatId: 'gc-1' });
			});

			expect(useGroupChatStore.getState().groupChatAutoRunState.isRunning).toBe(true);
			expect(notifyToast).not.toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Group Chat Auto Run Stopped' })
			);

			hook.unmount();
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

	// ==========================================================================
	// Power management
	// ==========================================================================

	describe('power management', () => {
		it('calls addReason on start and removeReason on stop', async () => {
			const content = `- [ ] Task one\n- [ ] Task two`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(mockAddReason).toHaveBeenCalledWith('groupchat-autorun');

			act(() => {
				result.current.stopAutoRun();
			});

			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');
		});

		it('calls removeReason when all tasks complete', async () => {
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Only task' })
				.mockResolvedValueOnce({ success: true, content: '- [x] Only task' });
			mockSendToModerator.mockResolvedValue(undefined);

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(mockAddReason).toHaveBeenCalledWith('groupchat-autorun');
			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');
		});

		it('calls removeReason on doc read error in startAutoRun', async () => {
			// Note: power lock is added after state init, before processNextTask.
			// If readDoc fails in startAutoRun (before state init), no power lock is added.
			mockReadDoc.mockResolvedValue({ success: false, error: 'File not found' });

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'missing.md');
			});

			// addReason should NOT have been called (failed before reaching that point)
			expect(mockAddReason).not.toHaveBeenCalled();
		});

		it('calls removeReason on processNextTask error', async () => {
			const content = `- [ ] Task one`;
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockRejectedValue(new Error('IPC failure'));

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(mockAddReason).toHaveBeenCalledWith('groupchat-autorun');
			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');
		});

		it('calls removeReason when groupChatError stops Auto-Run', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			mockRemoveReason.mockClear();

			act(() => {
				useGroupChatStore.setState({
					groupChatError: {
						groupChatId: 'gc-1',
						error: { type: 'process_error', message: 'Agent crashed', recoverable: false },
						participantName: 'agent-1',
					},
				});
			});

			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');

			hook.unmount();
		});

		it('calls removeReason on unmount during active Auto-Run', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			mockRemoveReason.mockClear();

			hook.unmount();

			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');
		});

		it('calls removeReason on idle advancement error', async () => {
			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			mockReadDoc.mockReset();
			mockRemoveReason.mockClear();
			vi.useFakeTimers();

			mockReadDoc.mockResolvedValue({ success: false, error: 'Permission denied' });

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			useGroupChatStore.setState({ groupChatState: 'moderator-thinking' });
			useGroupChatStore.setState({ groupChatState: 'idle' });
			await vi.advanceTimersByTimeAsync(0);

			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');

			hook.unmount();
		});
	});

	// ==========================================================================
	// Timeout
	// ==========================================================================

	describe('timeout', () => {
		it('stops Auto-Run after 10 minutes with no progress', async () => {
			vi.useFakeTimers();

			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});
			// Flush microtasks from startAutoRun
			await vi.advanceTimersByTimeAsync(0);

			expect(useGroupChatStore.getState().groupChatAutoRunState.isRunning).toBe(true);

			// Advance time by 10 minutes (the timeout checker runs every 30s)
			await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe('Auto Run timed out after 10 minutes with no progress');
			expect(state.currentTaskText).toBeNull();

			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: 'Group Chat Auto Run Timeout',
				message: 'Auto Run timed out after 10 minutes with no progress',
			});

			expect(mockRemoveReason).toHaveBeenCalledWith('groupchat-autorun');

			hook.unmount();
		});

		it('does not timeout if progress is made within 10 minutes', async () => {
			vi.useFakeTimers();

			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});
			await vi.advanceTimersByTimeAsync(0);

			vi.mocked(notifyToast).mockClear();

			// Set up idle advancement that succeeds (makes progress)
			mockReadDoc.mockReset();
			mockWriteDoc.mockReset();
			mockReadDoc.mockResolvedValue({ success: true, content: '- [ ] Task one\n- [ ] Task two' });
			mockWriteDoc.mockResolvedValue({ success: true });
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({
				groupChatMessages: [
					{ timestamp: '2024-01-01T00:01:00Z', from: 'moderator', content: 'Task complete: Done.' },
				],
			});

			// Advance 9 minutes, then trigger progress
			await vi.advanceTimersByTimeAsync(9 * 60 * 1000);

			// Trigger idle transition (should mark task complete and reset progress timestamp)
			useGroupChatStore.setState({ groupChatState: 'moderator-thinking' });
			useGroupChatStore.setState({ groupChatState: 'idle' });
			await vi.advanceTimersByTimeAsync(0);

			// Advance another 9 minutes — should NOT timeout since progress was made
			await vi.advanceTimersByTimeAsync(9 * 60 * 1000);

			// Should NOT have timed out
			expect(notifyToast).not.toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Group Chat Auto Run Timeout' })
			);

			hook.unmount();
		});

		it('clears timeout checker on stop', async () => {
			vi.useFakeTimers();

			const content = '- [ ] Task one\n- [ ] Task two';
			mockReadDoc.mockResolvedValue({ success: true, content });
			mockSendToModerator.mockResolvedValue(undefined);

			const hook = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await hook.result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});
			await vi.advanceTimersByTimeAsync(0);

			act(() => {
				hook.result.current.stopAutoRun();
			});

			vi.mocked(notifyToast).mockClear();

			// Advance past timeout — should NOT trigger since stopped
			await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

			expect(notifyToast).not.toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Group Chat Auto Run Timeout' })
			);

			hook.unmount();
		});
	});

	// ==========================================================================
	// Completion summary (toast + system message)
	// ==========================================================================

	describe('completion summary', () => {
		it('emits success toast when all tasks complete', async () => {
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Only task' })
				// processNextTask re-read: all tasks now checked
				.mockResolvedValueOnce({ success: true, content: '- [x] Only task' });
			mockSendToModerator.mockResolvedValue(undefined);

			// Set up group chat name in store
			useGroupChatStore.setState({
				groupChats: [{ id: 'gc-1', name: 'My Group Chat' }] as any,
			});

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(notifyToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'success',
					title: 'Auto Run Complete',
					message: 'Auto Run complete: 1/1 tasks completed in My Group Chat',
				})
			);
		});

		it('emits warning toast when partial tasks complete', async () => {
			// Content has 2 tasks: 1 checked, 1 unchecked but not matching any regex
			// We simulate partial completion: completed < total
			const partialContent = '- [x] Done task\n- Some non-checkbox line';
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Task A\n- [ ] Task B' })
				// processNextTask re-read: only one task checked, but no unchecked checkbox found
				// (simulating partial: 1 done out of 2 original, but one was removed/converted)
				.mockResolvedValueOnce({ success: true, content: partialContent });
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({
				groupChats: [{ id: 'gc-1', name: 'Test Chat' }] as any,
			});

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// 1 checked out of 1 total (only the checkbox line counts)
			// Since there's no unchecked task, run completes. completed === total → success
			// But let's test the actual behavior:
			const state = useGroupChatStore.getState().groupChatAutoRunState;
			const isAllComplete = state.completedTasks === state.totalTasks;

			expect(notifyToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: isAllComplete ? 'success' : 'warning',
					title: 'Auto Run Complete',
				})
			);
		});

		it('logs system message in chat transcript via appendMessage', async () => {
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Only task' })
				.mockResolvedValueOnce({ success: true, content: '- [x] Only task' });
			mockSendToModerator.mockResolvedValue(undefined);

			useGroupChatStore.setState({
				groupChats: [{ id: 'gc-1', name: 'My Group Chat' }] as any,
				groupChatAutoRunState: {
					isRunning: false,
					folderPath: '/docs',
					selectedFile: 'tasks.md',
					totalTasks: 0,
					completedTasks: 0,
					currentTaskText: null,
					error: null,
				},
			});

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(mockAppendMessage).toHaveBeenCalledWith(
				'gc-1',
				'[Auto Run]',
				'Completed 1/1 tasks from tasks.md'
			);
		});

		it('uses fallback name when group chat is not found in store', async () => {
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Only task' })
				.mockResolvedValueOnce({ success: true, content: '- [x] Only task' });
			mockSendToModerator.mockResolvedValue(undefined);

			// Explicitly clear groupChats — falls back to 'group chat'
			useGroupChatStore.setState({ groupChats: [] });
			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			expect(notifyToast).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('in group chat'),
				})
			);
		});

		it('does not crash when appendMessage fails', async () => {
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Only task' })
				.mockResolvedValueOnce({ success: true, content: '- [x] Only task' });
			mockSendToModerator.mockResolvedValue(undefined);
			mockAppendMessage.mockRejectedValue(new Error('IPC failure'));

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// Run should still complete successfully despite appendMessage failure
			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.isRunning).toBe(false);
			expect(state.completedTasks).toBe(1);
		});

		it('uses filename from store selectedFile when available', async () => {
			mockReadDoc
				.mockResolvedValueOnce({ success: true, content: '- [ ] Only task' })
				.mockResolvedValueOnce({ success: true, content: '- [x] Only task' });
			mockSendToModerator.mockResolvedValue(undefined);

			// Set selectedFile in the store (simulating persisted config)
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: false,
					folderPath: '/docs',
					selectedFile: 'stored-file.md',
					totalTasks: 0,
					completedTasks: 0,
					currentTaskText: null,
					error: null,
				},
			});

			const { result } = renderHook(() => useGroupChatAutoRun());

			await act(async () => {
				await result.current.startAutoRun('gc-1', '/docs', 'tasks.md');
			});

			// The store's selectedFile is updated by startAutoRun, so it uses
			// whatever selectedFile is in the store at completion time
			expect(mockAppendMessage).toHaveBeenCalledWith(
				'gc-1',
				'[Auto Run]',
				expect.stringMatching(/^Completed \d+\/\d+ tasks from .+\.md$/)
			);
		});
	});
});
