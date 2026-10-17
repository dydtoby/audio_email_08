export function AttachmentIcon({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.5 5.5L5.5 10.5C4.4 11.6 2.6 11.6 1.5 10.5C0.4 9.4 0.4 7.6 1.5 6.5L6.5 1.5C7.2 0.8 8.3 0.8 9 1.5C9.7 2.2 9.7 3.3 9 4L4.5 8.5C4.2 8.8 3.7 8.8 3.4 8.5C3.1 8.2 3.1 7.7 3.4 7.4L7.5 3.5"
        stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
