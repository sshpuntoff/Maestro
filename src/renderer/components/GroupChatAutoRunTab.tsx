/**
 * GroupChatAutoRunTab.tsx
 *
 * Auto Run tab for group chat right panel. Provides folder setup,
 * document selection, start/stop controls, progress display, and
 * error handling for group chat Auto-Run.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { FolderOpen, Play, Square, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import type { Theme } from '../types';
import { useGroupChatStore } from '../stores/groupChatStore';
import { useGroupChatAutoRun } from '../hooks/groupChat';
import { AutoRunSetupModal } from './AutoRunSetupModal';
import { countUnfinishedTasks, countCheckedTasks } from '../hooks/batch/batchUtils';

interface GroupChatAutoRunTabProps {
	theme: Theme;
	groupChatId: string;
}

/** Simple document entry with task counts for the document list. */
interface DocEntry {
	filename: string;
	completed: number;
	total: number;
}

export function GroupChatAutoRunTab({ theme, groupChatId }: GroupChatAutoRunTabProps): JSX.Element {
	// Auto-Run hook
	const { startAutoRun, stopAutoRun } = useGroupChatAutoRun();

	// Store state
	const autoRunState = useGroupChatStore((s) => s.groupChatAutoRunState);
	const { isRunning, completedTasks, totalTasks, currentTaskText, error } = autoRunState;

	// Local UI state
	const [showSetupModal, setShowSetupModal] = useState(false);
	const [folderPath, setFolderPath] = useState<string | null>(null);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [documents, setDocuments] = useState<DocEntry[]>([]);
	const [isLoadingDocs, setIsLoadingDocs] = useState(false);
	const [startTime, setStartTime] = useState<number | null>(null);
	const [elapsedDisplay, setElapsedDisplay] = useState('');
	const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Load persisted Auto-Run config when groupChatId changes
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const config = await window.maestro.groupChat.getAutoRunConfig(groupChatId);
				if (cancelled) return;
				if (config) {
					setFolderPath(config.folderPath || null);
					setSelectedFile(config.selectedFile || null);
				}
			} catch {
				// Config not available yet — ignore
			}
		})();
		return () => { cancelled = true; };
	}, [groupChatId]);

	// Load document list when folderPath changes
	const loadDocuments = useCallback(async (folder: string) => {
		setIsLoadingDocs(true);
		try {
			const result = await window.maestro.autorun.listDocs(folder);
			if (!result.success || !result.files) {
				setDocuments([]);
				return;
			}

			// For each file, read and count tasks
			const entries: DocEntry[] = [];
			for (const filename of result.files) {
				try {
					const docResult = await window.maestro.autorun.readDoc(folder, filename);
					if (docResult.success && docResult.content) {
						entries.push({
							filename,
							completed: countCheckedTasks(docResult.content),
							total: countCheckedTasks(docResult.content) + countUnfinishedTasks(docResult.content),
						});
					} else {
						entries.push({ filename, completed: 0, total: 0 });
					}
				} catch {
					entries.push({ filename, completed: 0, total: 0 });
				}
			}
			setDocuments(entries);
		} catch {
			setDocuments([]);
		} finally {
			setIsLoadingDocs(false);
		}
	}, []);

	useEffect(() => {
		if (folderPath) {
			loadDocuments(folderPath);
		} else {
			setDocuments([]);
		}
	}, [folderPath, loadDocuments]);

	// Elapsed time timer
	useEffect(() => {
		if (isRunning && !startTime) {
			setStartTime(Date.now());
		}
		if (!isRunning && startTime) {
			setStartTime(null);
			setElapsedDisplay('');
		}
	}, [isRunning, startTime]);

	useEffect(() => {
		if (startTime) {
			const update = () => {
				const elapsed = Math.floor((Date.now() - startTime) / 1000);
				const mins = Math.floor(elapsed / 60);
				const secs = elapsed % 60;
				setElapsedDisplay(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
			};
			update();
			elapsedTimerRef.current = setInterval(update, 1000);
			return () => {
				if (elapsedTimerRef.current) {
					clearInterval(elapsedTimerRef.current);
					elapsedTimerRef.current = null;
				}
			};
		}
	}, [startTime]);

	// Handle folder selection from setup modal
	const handleFolderSelected = useCallback(async (newFolderPath: string) => {
		setFolderPath(newFolderPath);
		setSelectedFile(null);
		setShowSetupModal(false);
		try {
			await window.maestro.groupChat.setAutoRunConfig(groupChatId, {
				folderPath: newFolderPath,
				selectedFile: undefined,
			});
		} catch {
			// Non-critical — config will be re-saved on next interaction
		}
	}, [groupChatId]);

	// Handle document selection
	const handleSelectDocument = useCallback(async (filename: string) => {
		setSelectedFile(filename);
		try {
			await window.maestro.groupChat.setAutoRunConfig(groupChatId, {
				folderPath: folderPath || undefined,
				selectedFile: filename,
			});
		} catch {
			// Non-critical
		}
	}, [groupChatId, folderPath]);

	// Handle start
	const handleStart = useCallback(async () => {
		if (!folderPath || !selectedFile) return;
		setStartTime(Date.now());
		await startAutoRun(groupChatId, folderPath, selectedFile);
	}, [groupChatId, folderPath, selectedFile, startAutoRun]);

	// Handle stop
	const handleStop = useCallback(() => {
		stopAutoRun();
		setStartTime(null);
		setElapsedDisplay('');
	}, [stopAutoRun]);

	// Handle retry (after error)
	const handleRetry = useCallback(async () => {
		const { setGroupChatAutoRunState } = useGroupChatStore.getState();
		setGroupChatAutoRunState({ error: null });
		if (folderPath && selectedFile) {
			await handleStart();
		}
	}, [folderPath, selectedFile, handleStart]);

	// ========================================================================
	// Render: No folder configured — empty state
	// ========================================================================
	if (!folderPath) {
		return (
			<div className="flex-1 overflow-y-auto p-3">
				<div className="flex flex-col items-center justify-center py-8 gap-3">
					<FolderOpen
						className="w-8 h-8 opacity-40"
						style={{ color: theme.colors.textDim }}
					/>
					<div
						className="text-sm text-center"
						style={{ color: theme.colors.textDim }}
					>
						Set up a folder to run tasks<br />
						sequentially through the group chat.
					</div>
					<button
						onClick={() => setShowSetupModal(true)}
						className="px-4 py-2 rounded text-sm font-bold transition-colors hover:opacity-90"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						Set Up Auto Run
					</button>
				</div>

				{showSetupModal && (
					<AutoRunSetupModal
						theme={theme}
						onClose={() => setShowSetupModal(false)}
						onFolderSelected={handleFolderSelected}
					/>
				)}
			</div>
		);
	}

	// ========================================================================
	// Render: Folder configured — document list + controls
	// ========================================================================
	return (
		<div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
			{/* Folder path display */}
			<button
				onClick={() => setShowSetupModal(true)}
				className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors hover:opacity-80 truncate"
				style={{
					backgroundColor: theme.colors.bgActivity,
					color: theme.colors.textDim,
					border: `1px solid ${theme.colors.border}`,
				}}
				title={`Folder: ${folderPath}\nClick to change`}
				disabled={isRunning}
			>
				<FolderOpen className="w-3.5 h-3.5 shrink-0" />
				<span className="truncate">{folderPath}</span>
			</button>

			{/* Document list */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<span
						className="text-xs font-bold"
						style={{ color: theme.colors.textDim }}
					>
						Documents
					</span>
					<button
						onClick={() => folderPath && loadDocuments(folderPath)}
						disabled={isLoadingDocs || isRunning}
						className={`p-1 rounded transition-colors hover:bg-white/10 ${isLoadingDocs ? 'opacity-50' : ''}`}
						style={{ color: theme.colors.textDim }}
						title="Refresh document list"
					>
						<RefreshCw className={`w-3.5 h-3.5 ${isLoadingDocs ? 'animate-spin' : ''}`} />
					</button>
				</div>

				{isLoadingDocs ? (
					<div className="flex items-center justify-center py-4">
						<Loader2
							className="w-4 h-4 animate-spin"
							style={{ color: theme.colors.textDim }}
						/>
					</div>
				) : documents.length === 0 ? (
					<div
						className="text-xs text-center py-3"
						style={{ color: theme.colors.textDim }}
					>
						No markdown files found
					</div>
				) : (
					<div className="space-y-0.5">
						{documents.map((doc) => {
							const isSelected = doc.filename === selectedFile;
							const pct = doc.total > 0 ? Math.round((doc.completed / doc.total) * 100) : null;
							return (
								<button
									key={doc.filename}
									onClick={() => handleSelectDocument(doc.filename)}
									disabled={isRunning}
									className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors hover:bg-white/5"
									style={{
										color: isSelected ? theme.colors.accent : theme.colors.textMain,
										backgroundColor: isSelected ? theme.colors.bgActivity : 'transparent',
									}}
								>
									{/* Task percentage badge */}
									<span
										className="shrink-0 text-xs px-1.5 py-0.5 rounded text-right"
										style={{
											width: '36px',
											backgroundColor: pct !== null
												? pct === 100
													? theme.colors.success
													: theme.colors.accentDim
												: 'transparent',
											color: pct !== null
												? pct === 100
													? '#000'
													: theme.colors.textDim
												: 'transparent',
										}}
									>
										{pct !== null ? `${pct}%` : ''}
									</span>
									<span className="truncate">{doc.filename}.md</span>
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* Start/Stop controls */}
			<div className="flex items-center gap-2">
				{isRunning ? (
					<button
						onClick={handleStop}
						className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-bold transition-colors hover:opacity-90"
						style={{
							backgroundColor: theme.colors.error,
							color: '#fff',
						}}
					>
						<Square className="w-3.5 h-3.5" />
						Stop
					</button>
				) : (
					<button
						onClick={handleStart}
						disabled={!selectedFile}
						className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-bold transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						<Play className="w-3.5 h-3.5" />
						Start
					</button>
				)}
			</div>

			{/* Progress display */}
			{(isRunning || (totalTasks > 0 && completedTasks > 0)) && (
				<div
					className="rounded px-3 py-2 space-y-1.5"
					style={{
						backgroundColor: theme.colors.bgActivity,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					{/* Task count fraction */}
					<div className="flex items-center justify-between">
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							Progress
						</span>
						<span className="text-xs font-bold" style={{ color: theme.colors.textMain }}>
							<span style={{ color: theme.colors.accent }}>{completedTasks}</span>
							{' / '}
							<span style={{ color: theme.colors.accent }}>{totalTasks}</span>
							{' tasks'}
						</span>
					</div>

					{/* Progress bar */}
					{totalTasks > 0 && (
						<div
							className="h-1.5 rounded-full overflow-hidden"
							style={{ backgroundColor: theme.colors.border }}
						>
							<div
								className="h-full rounded-full transition-all duration-300"
								style={{
									width: `${Math.round((completedTasks / totalTasks) * 100)}%`,
									backgroundColor: theme.colors.accent,
								}}
							/>
						</div>
					)}

					{/* Elapsed time */}
					{isRunning && elapsedDisplay && (
						<div className="flex items-center justify-between">
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								Elapsed
							</span>
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{elapsedDisplay}
							</span>
						</div>
					)}

					{/* Current task text (truncated) */}
					{isRunning && currentTaskText && (
						<div>
							<span
								className="text-xs"
								style={{ color: theme.colors.textDim }}
							>
								Current task:
							</span>
							<div
								className="text-xs mt-0.5 truncate"
								style={{ color: theme.colors.textMain }}
								title={currentTaskText}
							>
								{currentTaskText.length > 80
									? currentTaskText.slice(0, 80) + '...'
									: currentTaskText}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Error display */}
			{error && (
				<div
					className="rounded px-3 py-2 flex items-start gap-2"
					style={{
						backgroundColor: `${theme.colors.error}15`,
						border: `1px solid ${theme.colors.error}40`,
					}}
				>
					<AlertTriangle
						className="w-4 h-4 shrink-0 mt-0.5"
						style={{ color: theme.colors.error }}
					/>
					<div className="flex-1 min-w-0">
						<div
							className="text-xs font-bold"
							style={{ color: theme.colors.error }}
						>
							Auto Run Error
						</div>
						<div
							className="text-xs mt-0.5"
							style={{ color: theme.colors.textDim }}
						>
							{error}
						</div>
						<button
							onClick={handleRetry}
							className="text-xs mt-1.5 px-2 py-1 rounded transition-colors hover:opacity-80"
							style={{
								backgroundColor: theme.colors.error,
								color: '#fff',
							}}
						>
							Retry
						</button>
					</div>
				</div>
			)}

			{/* Setup modal */}
			{showSetupModal && (
				<AutoRunSetupModal
					theme={theme}
					onClose={() => setShowSetupModal(false)}
					onFolderSelected={handleFolderSelected}
					currentFolder={folderPath}
				/>
			)}
		</div>
	);
}
