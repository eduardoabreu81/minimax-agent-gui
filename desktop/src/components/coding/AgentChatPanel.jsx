import { useTranslation } from 'react-i18next'
import {
  Send, User, Bot, Loader2, Paperclip, X, Image as ImageIcon, FileText,
  MessageSquarePlus, Trash2, ChevronDown, Code2, Terminal, GitBranch
} from 'lucide-react'
import MarkdownRenderer from '../MarkdownRenderer'
import XTermTerminal from './XTermTerminal'
import { useCodingChat } from './useCodingChat'
import { useAgentActivity } from '../../context/AgentActivityContext'
import { useSelectedModel } from '../../hooks/useSelectedModel'
import { useState } from 'react'

export default function AgentChatPanel({
  activeFile, openFiles, fileContents,
  onOpenFile, onCloseFile, onSaveFile,
  getLanguage, gitStatus, changedFiles,
  runGitCommand, loadGitStatus, onFileChange,
  activeModel, thinkingEnabled, supportsThinking,
}) {
  const { t } = useTranslation()
  const { model: selectedModel } = useSelectedModel({ fallback: 'MiniMax-M3' })
  const chat = useCodingChat({
    activeModel,
    thinkingEnabled,
    supportsThinking,
    onActivity: (data) => {
      if (data.type === 'tool_result' && (data.tool === 'write_file' || data.tool === 'edit_file')) {
        onFileChange?.()
      }
    }
  })
  const activity = useAgentActivity()
  const [showEditorDrawer, setShowEditorDrawer] = useState(false)
  const [activeBottomTab, setActiveBottomTab] = useState('editor')
  const [commitMessage, setCommitMessage] = useState('')

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-card relative">
      {/* Chat Header */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-border bg-surface/50 shrink-0">
        <div className="flex items-center gap-2 relative" ref={chat.convListRef}>
          <Bot size={16} className="text-primary" />
          <button
            onClick={() => chat.setShowConvList(!chat.showConvList)}
            className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-primary transition-colors"
          >
            {chat.conversations.find(c => c.id === chat.sessionId)?.title || 'Code Chat'}
            <ChevronDown size={14} className={`transition-transform ${chat.showConvList ? 'rotate-180' : ''}`} />
          </button>
          {chat.showConvList && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-card border border-border rounded-xl shadow-lg z-50 py-2 max-h-80 overflow-y-auto">
              <button
                onClick={chat.startNewChat}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 transition-colors"
              >
                <MessageSquarePlus size={14} /> New Code Chat
              </button>
              <div className="border-t border-border my-1" />
              {chat.conversations.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No previous code chats</p>
              )}
              {chat.conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => chat.loadConversation(conv)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface transition-colors ${conv.id === chat.sessionId ? 'bg-primary/10' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{conv.title}</p>
                    <p className="text-[10px] text-muted-foreground">{conv.message_count} messages</p>
                  </div>
                  <button
                    onClick={(e) => chat.deleteConversation(e, conv.id)}
                    className="p-1 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEditorDrawer(!showEditorDrawer)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${showEditorDrawer ? 'bg-primary/10 text-primary' : 'bg-surface border border-border hover:border-primary text-muted-foreground'}`}
          >
            <Code2 size={12} /> Editor
          </button>
          <button onClick={chat.startNewChat} className="p-2 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground transition-colors" title="New chat">
            <MessageSquarePlus size={14} />
          </button>
          <div className={`w-2 h-2 rounded-full ${chat.isConnected ? 'bg-success' : 'bg-error'}`} />
        </div>
      </div>

      {/* Messages */}
      <div ref={chat.chatRef} className="flex-1 overflow-y-auto p-6 space-y-5">
        {chat.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center">
            <Bot size={48} className="mb-4 opacity-30" />
            <p className="text-sm">Ask me about your code</p>
            <p className="text-xs mt-1 opacity-60">I can see the file you have open</p>
          </div>
        )}

        {chat.messages.map((msg, idx) => {
          if (msg.type === 'system') {
            return (
              <div key={idx} className="flex justify-center my-2">
                <span className="text-xs text-muted-foreground bg-surface border border-border px-3 py-1 rounded-full">{msg.content}</span>
              </div>
            )
          }
          return (
            <div key={idx} className={`flex gap-3 ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                ${msg.type === 'user' ? 'bg-primary' : 'bg-surface border border-border'}
              `}>
                {msg.type === 'user' ? <User size={14} className="text-white" /> : <Bot size={14} className="text-primary" />}
              </div>
              <div className={`
                max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed
                ${msg.type === 'user'
                  ? 'bg-primary text-white rounded-br-md'
                  : 'bg-surface border border-border text-foreground rounded-bl-md'
                }
              `}>
                <MarkdownRenderer content={msg.content} />
                {msg.attachment && (
                  <div className="mt-2 pt-2 border-t border-white/20">
                    {/\.(png|jpg|jpeg|webp|gif)$/i.test(msg.attachment) ? (
                      <img
                        src={`/api/files/download?path=${encodeURIComponent(msg.attachment)}`}
                        alt="attachment"
                        className="max-w-[200px] max-h-[150px] rounded-lg object-cover"
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-xs opacity-90">
                        <FileText size={14} />
                        <span className="truncate max-w-[200px]">{msg.attachment.split('/').pop()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {chat.isThinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
              <Bot size={14} className="text-primary" />
            </div>
            <div className="bg-surface border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 size={16} className="animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="p-4 border-t border-border bg-surface/50 shrink-0">
        <div className="max-w-4xl mx-auto">
          {chat.attachment && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg w-fit">
              {chat.attachment.type?.startsWith('image/') ? <ImageIcon size={12} className="text-primary" /> : <FileText size={12} className="text-primary" />}
              <span className="text-xs text-primary">{chat.attachment.name}</span>
              <button onClick={() => chat.setAttachment(null)} className="text-primary hover:text-primary/70">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="relative">
                <textarea
                  value={chat.input}
                  onChange={(e) => {
                    const value = e.target.value
                    chat.setInput(value)
                    if (value.startsWith('/')) {
                      if (!chat.showSkills) chat.fetchSkills()
                      chat.setShowSkills(true)
                      chat.setSkillIndex(0)
                    } else {
                      chat.setShowSkills(false)
                    }
                  }}
                  onKeyDown={chat.handleKeyDown}
                  placeholder="Ask about your code..."
                  rows={2}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors"
                />
                {chat.showSkills && chat.filteredSkills.length > 0 && (
                  <div className="absolute bottom-full left-0 w-full bg-card border border-border rounded-xl shadow-lg z-50 py-1 mb-1 max-h-48 overflow-y-auto">
                    {chat.filteredSkills.map((skill, i) => (
                      <div
                        key={skill.name}
                        onClick={() => chat.activateSkill(skill.name)}
                        className={`px-3 py-2 cursor-pointer ${i === chat.skillIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface'}`}
                      >
                        <div className="text-sm font-medium">{skill.name}</div>
                        <div className="text-xs text-muted-foreground">{skill.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center mt-1">
                <p className="text-[10px] text-muted-foreground">Enter to send · Shift+Enter for new line</p>
                <p className="text-[10px] text-primary font-medium">{selectedModel}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <input
                type="file"
                ref={chat.fileInputRef}
                onChange={chat.handleFileSelect}
                accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.html,.css"
                className="hidden"
              />
              <button
                onClick={() => chat.fileInputRef.current?.click()}
                disabled={!chat.isConnected}
                className="px-3 py-3 bg-surface hover:bg-surface-hover border border-border disabled:opacity-40 text-foreground rounded-xl transition-colors flex items-center justify-center"
                title="Attach file or image"
              >
                <Paperclip size={16} />
              </button>
              <button
                onClick={chat.sendMessage}
                disabled={(!chat.input.trim() && !chat.attachment) || !chat.isConnected || chat.isThinking}
                className="px-5 py-3 bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Editor/Terminal Drawer */}
      {showEditorDrawer && (
        <div className="absolute bottom-0 left-0 right-0 h-80 bg-card border-t border-border flex flex-col z-20 shadow-lg">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/50 shrink-0">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveBottomTab('editor')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${activeBottomTab === 'editor' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Code2 size={12} /> Editor
              </button>
              <button
                onClick={() => setActiveBottomTab('terminal')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${activeBottomTab === 'terminal' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Terminal size={12} /> Terminal
              </button>
              <button
                onClick={() => { setActiveBottomTab('git'); loadGitStatus() }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${activeBottomTab === 'git' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <GitBranch size={12} /> Git
              </button>
            </div>
            <button onClick={() => setShowEditorDrawer(false)} className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {activeBottomTab === 'editor' && (
              <div className="h-full flex flex-col">
                {openFiles.length > 0 && (
                  <div className="flex border-b border-border bg-surface/30 overflow-x-auto shrink-0">
                    {openFiles.map((file) => (
                      <div
                        key={file.path}
                        onClick={() => onOpenFile(file.path)}
                        className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-r border-border transition-colors whitespace-nowrap group cursor-pointer ${
                          activeFile === file.path
                            ? 'bg-surface text-foreground border-t-2 border-t-primary'
                            : 'text-muted-foreground hover:text-foreground hover:bg-surface/50'
                        }`}
                      >
                        <Code2 size={12} />
                        <span>{file.name}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onCloseFile(file.path) }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error/20 transition-opacity"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  {activeFile ? (
                    <textarea
                      value={fileContents[activeFile] || ''}
                      onChange={(e) => {/* handled by parent */}}
                      className="w-full h-full bg-card text-foreground p-4 font-mono text-sm resize-none focus:outline-none"
                      spellCheck={false}
                      placeholder={`// ${getLanguage(activeFile.split('/').pop())}`}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <Code2 size={32} className="mb-3 opacity-20" />
                      <p className="text-xs">Select a file to edit</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeBottomTab === 'terminal' && <XTermTerminal />}
            {activeBottomTab === 'git' && (
              <div className="h-full overflow-y-auto p-3 text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <GitBranch size={14} className="text-primary" />
                  <span className="font-mono text-foreground">{gitStatus?.branch || 'N/A'}</span>
                </div>
                {changedFiles.length > 0 ? (
                  <>
                    {changedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-surface">
                        <span className={`font-mono ${f.staged ? 'text-green-500' : 'text-amber-500'}`}>{f.status}</span>
                        <span className="text-foreground">{f.path}</span>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-2">
                      <input
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Commit message..."
                        className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => { runGitCommand(`git add -A && git commit -m "${commitMessage}"`); setCommitMessage(''); loadGitStatus() }}
                        className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                      >
                        <GitBranch size={12} /> Commit
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-center py-4">Working tree clean</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
