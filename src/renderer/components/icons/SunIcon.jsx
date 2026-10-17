export function SunIcon({ size = 16, color = 'currentColor', className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M7.66667 1V2.33333M7.66667 13V14.3333M2.95333 2.95333L3.89333 3.89333M11.44 11.44L12.38 12.38M1 7.66667H2.33333M13 7.66667H14.3333M3.89333 11.44L2.95333 12.38M12.38 2.95333L11.44 3.89333M10.3333 7.66667C10.3333 9.13943 9.13943 10.3333 7.66667 10.3333C6.19391 10.3333 5 9.13943 5 7.66667C5 6.19391 6.19391 5 7.66667 5C9.13943 5 10.3333 6.19391 10.3333 7.66667Z"
        stroke={color}
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
