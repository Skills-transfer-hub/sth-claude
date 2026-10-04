import type { BoxProps, ButtonProps, ElementChildren, ElementTable, PaneOpenArgs, RenderInput } from 'claude-code'

/** Shared chrome only. Buddy keeps its own renderer, layout and animation. */
export function panelChrome(elements: ElementTable, e: RenderInput) {
  const { Box, Button: NativeButton } = elements
  const Page = ({ children, ...props }: BoxProps & ElementChildren) => (
    <Box flexDirection="column" gap={1} paddingX={1} {...props}>{children}</Box>
  )
  const Card = ({ children, ...props }: BoxProps & ElementChildren) => (
    <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1} {...props}>{children}</Box>
  )
  const Toolbar = ({ children, ...props }: BoxProps & ElementChildren) => (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1} {...props}>{children}</Box>
  )
  // Keep the native chrome: its entire visible area is a real click target.
  // A decorative Box around a plain label leaves its border unclickable.
  const Button = ({ children, plain: _plain, ...props }: ButtonProps & ElementChildren) => (
    <NativeButton {...props} variant="secondary">{children}</NativeButton>
  )
  return { Page, Card, Toolbar, Button }
}

/** Secondary pages have one explicit way back; tools are reached from Home. */
export function paneNavigation(elements: ElementTable, e: RenderInput<'Pane'>, active: string,
  onOpen: (pane: PaneOpenArgs) => unknown) {
  const { Box } = elements
  const { Button } = panelChrome(elements, e)
  const current = active.startsWith('sth-') ? active : `sth-${active}`
  return <Box key="pane-navigation" flexDirection="row" alignItems="center" gap={1}>
    {current !== 'sth-usage' && <Button key="nav-home" label="← Home" hotkey="h"
      onPress={() => onOpen({ id: 'sth-usage', title: 'Buddy · Usage', rows: 36, columns: 50, focus: true })} />}
  </Box>
}
