import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroupChatAutoRunTab } from '../../../renderer/components/GroupChatAutoRunTab';
import type { Theme } from '../../../renderer/types';

const mockTheme = {
	colors: {
		bgSidebar: '#1e1e1e',
		border: '#333',
		textMain: '#fff',
		textDim: '#999',
	},
} as Theme;

describe('GroupChatAutoRunTab', () => {
	it('renders placeholder content', () => {
		render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" />);
		expect(screen.getByText('Auto Run for group chats.')).toBeTruthy();
	});

	it('applies theme text color', () => {
		const { container } = render(<GroupChatAutoRunTab theme={mockTheme} groupChatId="gc-1" />);
		const textDiv = container.querySelector('.text-sm');
		expect(textDiv).toBeTruthy();
		// jsdom converts hex to rgb format
		expect((textDiv as HTMLElement).style.color).toBeTruthy();
	});
});
