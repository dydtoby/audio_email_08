export function MailIcon({ size = 16, color = 'currentColor', className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 17" fill="none" className={className}>
      <path
        d="M14.3333 5L8.35333 8.8C8.14751 8.92895 7.90954 8.99734 7.66667 8.99734C7.42379 8.99734 7.18582 8.92895 6.98 8.8L1 5M2.33333 3H13C13.7364 3 14.3333 3.59695 14.3333 4.33333V12.3333C14.3333 13.0697 13.7364 13.6667 13 13.6667H2.33333C1.59695 13.6667 1 13.0697 1 12.3333V4.33333C1 3.59695 1.59695 3 2.33333 3Z"
        stroke={color}
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
