interface AttackQueueIndicatorProps {
  count: number
}

export function AttackQueueIndicator({ count }: AttackQueueIndicatorProps) {
  if (count === 0) return null

  return (
    <span className="font-mono text-xs text-orange-400">
      ⚔ {count} incoming
    </span>
  )
}
