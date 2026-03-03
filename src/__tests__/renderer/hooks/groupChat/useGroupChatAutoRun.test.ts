/**
 * Tests for useGroupChatAutoRun hook and extractFirstUncheckedTask utility.
 *
 * Tests cover:
 * - extractFirstUncheckedTask: pure function for parsing first unchecked task
 * - startAutoRun: reads doc, initializes store state, sends first task to moderator
 * - stopAutoRun: sets stoppedRef, updates store
 * - Error handling: doc read failures, no tasks found
 * - processNextTask: re-reads doc, extracts next task, sends to moderator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
	useGroupChatAutoRun,
	extractFirstUncheckedTask,
} from '../../../../renderer/hooks/groupChat/useGroupChatAutoRun';
import { useGroupChatStore } from '../../../../renderer/stores/groupChatStore';

// ============================================================================
// Mocks
// ============================================================================

const mockReadDoc = vi.fn();
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
	});

	// Mock window.maestro
	(window as any).maestro = {
		...(window as any).maestro,
		autorun: {
			readDoc: mockReadDoc,
		},
		groupChat: {
			...(window as any).maestro?.groupChat,
			sendToModerator: mockSendToModerator,
		},
	};
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

			expect(mockSendToModerator).toHaveBeenCalledWith('gc-1', 'First open task');
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

			// processNextTask was called, re-read doc, found no unchecked tasks
			// The first sendToModerator from startAutoRun → processNextTask won't be called
			// because processNextTask re-reads and finds no unchecked tasks
			const state = useGroupChatStore.getState().groupChatAutoRunState;
			// Run completed because second read had no unchecked tasks
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
});
