/**
 * Tests for GroupChatPanel — notification suppression during Auto-Run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GroupChatPanel } from '../../../renderer/components/GroupChatPanel';
import { useGroupChatStore } from '../../../renderer/stores/groupChatStore';
import type { Theme, Shortcut, GroupChat, GroupChatMessage, GroupChatState } from '../../../renderer/types';

// ---------------------------------------------------------------------------
// Track props received by GroupChatInput (the consumer of showFlashNotification)
// ---------------------------------------------------------------------------
let capturedInputProps: Record<string, any> = {};

vi.mock('../../../renderer/components/GroupChatInput', () => ({
	GroupChatInput: (props: any) => {
		capturedInputProps = props;
		return <div data-testid="group-chat-input" />;
	},
}));

vi.mock('../../../renderer/components/GroupChatHeader', () => ({
	GroupChatHeader: () => <div data-testid="group-chat-header" />,
}));

vi.mock('../../../renderer/components/GroupChatMessages', () => ({
	GroupChatMessages: vi.fn().mockImplementation(() => <div data-testid="group-chat-messages" />),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockTheme = {
	colors: {
		bgMain: '#1e1e1e',
		bgSidebar: '#1e1e1e',
		bgActivity: '#2d2d2d',
		border: '#333',
		textMain: '#fff',
		textDim: '#999',
		accent: '#7aa2f7',
		accentDim: 'rgba(122, 162, 247, 0.2)',
		success: '#4caf50',
		warning: '#ff9800',
		error: '#f44336',
	},
} as Theme;

const mockGroupChat: GroupChat = {
	id: 'gc-1',
	name: 'Test Chat',
	participants: [{ name: 'Agent1', agentId: 'claude-code' }],
	moderatorAgentId: 'claude-code',
	createdAt: Date.now(),
} as GroupChat;

const mockShortcuts: Record<string, Shortcut> = {};
const mockSessions: any[] = [];
const mockShowFlash = vi.fn();

const defaultProps = {
	theme: mockTheme,
	groupChat: mockGroupChat,
	messages: [] as GroupChatMessage[],
	state: 'idle' as GroupChatState,
	onSendMessage: vi.fn(),
	onRename: vi.fn(),
	onShowInfo: vi.fn(),
	rightPanelOpen: false,
	onToggleRightPanel: vi.fn(),
	shortcuts: mockShortcuts,
	sessions: mockSessions,
	showFlashNotification: mockShowFlash,
};

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	capturedInputProps = {};
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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GroupChatPanel — notification suppression during Auto-Run', () => {
	it('passes showFlashNotification to GroupChatInput when Auto-Run is NOT running', () => {
		render(<GroupChatPanel {...defaultProps} />);
		expect(capturedInputProps.showFlashNotification).toBe(mockShowFlash);
	});

	it('passes undefined showFlashNotification to GroupChatInput when Auto-Run IS running', () => {
		useGroupChatStore.setState({
			groupChatAutoRunState: {
				isRunning: true,
				folderPath: '/tmp/docs',
				selectedFile: 'tasks.md',
				totalTasks: 5,
				completedTasks: 2,
				currentTaskText: 'Do something',
				error: null,
			},
		});

		render(<GroupChatPanel {...defaultProps} />);
		expect(capturedInputProps.showFlashNotification).toBeUndefined();
	});

	it('restores showFlashNotification when Auto-Run stops', () => {
		// Start with Auto-Run running
		useGroupChatStore.setState({
			groupChatAutoRunState: {
				isRunning: true,
				folderPath: '/tmp/docs',
				selectedFile: 'tasks.md',
				totalTasks: 5,
				completedTasks: 2,
				currentTaskText: 'Do something',
				error: null,
			},
		});

		const { rerender } = render(<GroupChatPanel {...defaultProps} />);
		expect(capturedInputProps.showFlashNotification).toBeUndefined();

		// Stop Auto-Run
		act(() => {
			useGroupChatStore.setState({
				groupChatAutoRunState: {
					isRunning: false,
					folderPath: '/tmp/docs',
					selectedFile: 'tasks.md',
					totalTasks: 5,
					completedTasks: 5,
					currentTaskText: null,
					error: null,
				},
			});
		});

		rerender(<GroupChatPanel {...defaultProps} />);
		expect(capturedInputProps.showFlashNotification).toBe(mockShowFlash);
	});

	it('passes undefined when showFlashNotification prop is not provided (regardless of Auto-Run)', () => {
		const { showFlashNotification: _, ...propsWithoutFlash } = defaultProps;
		render(<GroupChatPanel {...propsWithoutFlash} />);
		expect(capturedInputProps.showFlashNotification).toBeUndefined();
	});
});
