export function ImageIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.333" y="2" width="13.333" height="12" rx="1.333"
        stroke={color} strokeWidth="1.333" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="5.333" cy="5.667" r="1" stroke={color} strokeWidth="1.333"/>
      <path d="M1.333 10.667L4.667 7.333L7.333 10L9.333 8L14.667 14"
        stroke={color} strokeWidth="1.333" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
