/**
 * GroupChatAutoRunTab.tsx
 *
 * Auto Run tab for group chat right panel. Provides folder setup,
 * document selection, start/stop controls, progress display, and
 * error handling for group chat Auto-Run.
 *
 * Placeholder — full implementation in a subsequent task.
 */

import type { Theme } from '../types';

interface GroupChatAutoRunTabProps {
	theme: Theme;
	groupChatId: string;
}

export function GroupChatAutoRunTab({ theme, groupChatId }: GroupChatAutoRunTabProps): JSX.Element {
	return (
		<div className="flex-1 overflow-y-auto p-3">
			<div
				className="text-sm text-center py-8"
				style={{ color: theme.colors.textDim }}
			>
				Auto Run for group chats.
				<br />
				<span className="text-xs opacity-60">Coming soon</span>
			</div>
		</div>
	);
}
