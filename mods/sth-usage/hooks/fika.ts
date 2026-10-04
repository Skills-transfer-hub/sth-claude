import type { SessionMessage } from 'claude-code'

// Navigating with slash commands is not writing a prompt to Claude.
export function isPromptText(text: string): boolean {
  const value = text.trim()
  return value !== '' && !value.startsWith('/')
}

export function isUserPrompt(message: SessionMessage): boolean {
  if (message.role !== 'user' || message.toolResults?.length) return false
  const text = message.text.trim()
  return isPromptText(text) && !/^<(?:command-name|command-message|local-command-(?:stdout|stderr|caveat))>/.test(text)
}
