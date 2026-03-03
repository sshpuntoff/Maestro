import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { GroupChatAutoRunTab } from '../../../renderer/components/GroupChatAutoRunTab';
import { useGroupChatStore } from '../../../renderer/stores/groupChatStore';
import type { Theme } from '../../../renderer/types';

// Mock startAutoRun / stopAutoRun (now passed as props instead of via hook)
const mockStartAutoRun = vi.fn().mockResolvedValue(undefined);
const mockStopAutoRun = vi.fn();

// Mock AutoRunSetupModal
let capturedOnFolderSelected: ((folderPath: string) => void) | null = null;
vi.mock('../../../renderer/components/AutoRunSetupModal', () => ({
	AutoRunSetupModal: ({
		onClose,
		onFolderSelected,
	}: {
		theme: Theme;
		onClose: () => void;
		onFolderSelected: (folderPath: string) => void;
		currentFolder?: string;
	}) => {
		capturedOnFolderSelected = onFolderSelected;
		return (
			<div data-testid="setup-modal">
				<button data-testid="setup-modal-close" onClick={onClose}>
					Close
				</button>
				<button
					data-testid="setup-modal-select"
					onClick={() => onFolderSelected('/test/folder')}
				>
					Select Folder
				</button>
			</div>
		);
	},
}));

// Mock batchUtils
vi.mock('../../../renderer/hooks/batch/batchUtils', () => ({
	countUnfinishedTasks: vi.fn().mockReturnValue(3),
	countCheckedTasks: vi.fn().mockReturnValue(2),
}));

const mockTheme = {
	colors: {
		bgMain: '#1a1a1a',
		bgSidebar: '#1e1e1e',
		bgActivity: '#2a2a2a',
		border: '#333',
		textMain: '#fff',
		textDim: '#999',
		accent: '#0066ff',
		accentForeground: '#fff',
		accentDim: '#003388',
		error: '#ff4444',
		success: '#44ff44',
	},
} as Theme;

// Mock groupChat IPC
const mockGroupChat = {
	getAutoRunConfig: vi.fn().mockResolvedValue(null),
	setAutoRunConfig: vi.fn().mockResolvedValue({}),
	sendToModerator: vi.fn().mockResolvedValue(undefined),
};

describe('GroupChatAutoRunTab', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedOnFolderSelected = null;

		// Reset store to defaults
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

		// Setup window.maestro.groupChat mock
		if (!(window.maestro as any).groupChat) {
			(window.maestro as any).groupChat = mockGroupChat;
		}
		Object.assign((window.maestro as any).groupChat, mockGroupChat);

		// Reset autorun mocks
		(window.maestro.autorun.listDocs as any).mockResolvedValue({
			success: true,
			files: [],
		});
		(window.maestro.autorun.readDoc as any).mockResolvedValue({
			success: true,
			content: '',
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ========================================================================
	// Empty state (no folder configured)
	// ========================================================================
	describe('empty state (no folder)', () => {
		it('renders setup prompt when no folder is configured', () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);
			expect(screen.getByText('Set Up Auto Run')).toBeTruthy();
			expect(screen.getByText(/Set up a folder/)).toBeTruthy();
		});

		it('opens setup modal when "Set Up Auto Run" is clicked', () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);
			fireEvent.click(screen.getByText('Set Up Auto Run'));
			expect(screen.getByTestId('setup-modal')).toBeTruthy();
		});

		it('loads persisted config on mount', async () => {
			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/saved/folder',
				selectedFile: 'tasks',
			});

			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: ['tasks'],
			});
			(window.maestro.autorun.readDoc as any).mockResolvedValue({
				success: true,
				content: '- [ ] Task 1\n- [x] Task 2',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(mockGroupChat.getAutoRunConfig).toHaveBeenCalledWith('gc-1');
			});
		});
	});

	// ========================================================================
	// Folder configured — document list
	// ========================================================================
	describe('folder configured', () => {
		beforeEach(() => {
			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/autorun',
				selectedFile: null,
			});

			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: ['doc-a', 'doc-b'],
			});
			(window.maestro.autorun.readDoc as any).mockResolvedValue({
				success: true,
				content: '- [ ] Task A\n- [x] Task B\n- [ ] Task C',
			});
		});

		it('shows folder path and document list after config loads', async () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('/test/autorun')).toBeTruthy();
			});

			await waitFor(() => {
				expect(screen.getByText('doc-a.md')).toBeTruthy();
				expect(screen.getByText('doc-b.md')).toBeTruthy();
			});
		});

		it('shows "Documents" label', async () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('Documents')).toBeTruthy();
			});
		});

		it('shows "No markdown files found" when folder has no docs', async () => {
			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: [],
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('No markdown files found')).toBeTruthy();
			});
		});

		it('selects a document and persists config', async () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('doc-a.md')).toBeTruthy();
			});

			fireEvent.click(screen.getByText('doc-a.md'));

			await waitFor(() => {
				expect(mockGroupChat.setAutoRunConfig).toHaveBeenCalledWith('gc-1', {
					folderPath: '/test/autorun',
					selectedFile: 'doc-a',
				});
			});
		});

		it('shows Start button disabled when no document is selected', async () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				const startBtn = screen.getByText('Start');
				expect(startBtn.closest('button')?.disabled).toBe(true);
			});
		});
	});

	// ========================================================================
	// Start/Stop controls
	// ========================================================================
	describe('start/stop controls', () => {
		beforeEach(() => {
			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: ['tasks'],
			});
			(window.maestro.autorun.readDoc as any).mockResolvedValue({
				success: true,
				content: '- [ ] Task 1\n- [x] Task 2',
			});
		});

		it('calls startAutoRun when Start button is clicked', async () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			// Wait for config to load and select the document
			await waitFor(() => {
				expect(screen.getByText('tasks.md')).toBeTruthy();
			});

			// The document should be pre-selected from config
			await waitFor(() => {
				const startBtn = screen.getByText('Start');
				expect(startBtn.closest('button')?.disabled).toBe(false);
			});

			fireEvent.click(screen.getByText('Start'));

			await waitFor(() => {
				expect(mockStartAutoRun).toHaveBeenCalledWith('gc-1', '/test/folder', 'tasks');
			});
		});

		it('shows Stop button when running', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 2,
					currentTaskText: 'Do something',
					error: null,
				},
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('Stop')).toBeTruthy();
			});
		});

		it('calls stopAutoRun when Stop button is clicked', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 2,
					currentTaskText: 'Do something',
					error: null,
				},
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				fireEvent.click(screen.getByText('Stop'));
				expect(mockStopAutoRun).toHaveBeenCalled();
			});
		});
	});

	// ========================================================================
	// Progress display
	// ========================================================================
	describe('progress display', () => {
		it('shows task progress when running', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 7,
					completedTasks: 3,
					currentTaskText: null,
					error: null,
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('3')).toBeTruthy();
				expect(screen.getByText('7')).toBeTruthy();
				expect(screen.getByText(/tasks/)).toBeTruthy();
			});
		});

		it('shows current task text when running', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 1,
					currentTaskText: 'Implement the login feature',
					error: null,
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('Current task:')).toBeTruthy();
				expect(screen.getByText('Implement the login feature')).toBeTruthy();
			});
		});

		it('truncates long task text', async () => {
			const longText = 'A'.repeat(100);

			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 1,
					currentTaskText: longText,
					error: null,
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				const taskDisplay = screen.getByTitle(longText);
				expect(taskDisplay.textContent).toContain('...');
			});
		});

		it('shows progress label', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 2,
					currentTaskText: null,
					error: null,
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('Progress')).toBeTruthy();
			});
		});
	});

	// ========================================================================
	// Error display
	// ========================================================================
	describe('error display', () => {
		it('shows error message when error is set', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: false,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 2,
					currentTaskText: null,
					error: 'Connection lost to moderator',
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('Auto Run Error')).toBeTruthy();
				expect(screen.getByText('Connection lost to moderator')).toBeTruthy();
			});
		});

		it('shows retry button on error', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: false,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 0,
					completedTasks: 0,
					currentTaskText: null,
					error: 'Something went wrong',
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('Retry')).toBeTruthy();
			});
		});

		it('clears error and restarts on retry', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: false,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 0,
					completedTasks: 0,
					currentTaskText: null,
					error: 'Something went wrong',
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: ['tasks'],
			});
			(window.maestro.autorun.readDoc as any).mockResolvedValue({
				success: true,
				content: '- [ ] Task 1',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('Retry')).toBeTruthy();
			});

			await act(async () => {
				fireEvent.click(screen.getByText('Retry'));
			});

			// Error should be cleared in the store
			const state = useGroupChatStore.getState().groupChatAutoRunState;
			expect(state.error).toBeNull();
		});
	});

	// ========================================================================
	// Folder setup modal integration
	// ========================================================================
	describe('folder setup modal', () => {
		it('opens setup modal when folder path button is clicked', async () => {
			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/existing/folder',
				selectedFile: null,
			});

			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: [],
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				expect(screen.getByText('/existing/folder')).toBeTruthy();
			});

			fireEvent.click(screen.getByText('/existing/folder'));

			expect(screen.getByTestId('setup-modal')).toBeTruthy();
		});

		it('updates folder path on selection from setup modal', async () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			// Open setup modal from empty state
			fireEvent.click(screen.getByText('Set Up Auto Run'));
			expect(screen.getByTestId('setup-modal')).toBeTruthy();

			// Select folder from mock modal
			await act(async () => {
				fireEvent.click(screen.getByTestId('setup-modal-select'));
			});

			await waitFor(() => {
				expect(mockGroupChat.setAutoRunConfig).toHaveBeenCalledWith('gc-1', {
					folderPath: '/test/folder',
					selectedFile: undefined,
				});
			});
		});

		it('closes setup modal on close button click', async () => {
			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			fireEvent.click(screen.getByText('Set Up Auto Run'));
			expect(screen.getByTestId('setup-modal')).toBeTruthy();

			fireEvent.click(screen.getByTestId('setup-modal-close'));

			expect(screen.queryByTestId('setup-modal')).toBeNull();
		});
	});

	// ========================================================================
	// Running state disables controls
	// ========================================================================
	describe('running state disables controls', () => {
		it('disables folder path button when running', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 2,
					currentTaskText: 'Current task',
					error: null,
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: ['tasks'],
			});
			(window.maestro.autorun.readDoc as any).mockResolvedValue({
				success: true,
				content: '- [ ] Task 1',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				const folderBtn = screen.getByText('/test/folder').closest('button');
				expect(folderBtn?.disabled).toBe(true);
			});
		});

		it('disables document selection when running', async () => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: true,
					folderPath: '/test/folder',
					selectedFile: 'tasks',
					totalTasks: 5,
					completedTasks: 2,
					currentTaskText: 'Current task',
					error: null,
				},
			});

			mockGroupChat.getAutoRunConfig.mockResolvedValue({
				folderPath: '/test/folder',
				selectedFile: 'tasks',
			});

			(window.maestro.autorun.listDocs as any).mockResolvedValue({
				success: true,
				files: ['tasks', 'other-doc'],
			});
			(window.maestro.autorun.readDoc as any).mockResolvedValue({
				success: true,
				content: '- [ ] Task 1',
			});

			render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" startAutoRun={mockStartAutoRun} stopAutoRun={mockStopAutoRun} />);

			await waitFor(() => {
				const docBtn = screen.getByText('other-doc.md').closest('button');
				expect(docBtn?.disabled).toBe(true);
			});
		});
	});
});
