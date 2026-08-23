// A single 16px stroke set, inlined so the app keeps no icon dependency.
// Every icon inherits currentColor and is sized by the class it is given.

type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SessionsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.5" y="2.5" width="13" height="10" rx="1.5" />
    <path d="M1.5 5.5h13" />
    <path d="M4 4h.01M6 4h.01" />
  </Icon>
);

export const TargetsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="2" />
    <path d="M8 .8v2M8 13.2v2M.8 8h2M13.2 8h2" />
  </Icon>
);

export const ShippingIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 1.6 14 5v6l-6 3.4L2 11V5z" />
    <path d="M2 5l6 3.4L14 5" />
    <path d="M8 8.4v6" />
  </Icon>
);

export const RunsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.5 8.5h3l2-5 3 10 2-5h3" />
  </Icon>
);

export const NetworkIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4" />
    <path d="M8 1.8c1.7 1.9 2.6 4 2.6 6.2S9.7 12.3 8 14.2C6.3 12.3 5.4 10.2 5.4 8S6.3 3.7 8 1.8z" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M12.7 9.7a1.2 1.2 0 0 0 .24 1.32l.04.05a1.4 1.4 0 1 1-1.98 1.98l-.05-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.73 1.1v.13a1.4 1.4 0 1 1-2.8 0v-.07a1.2 1.2 0 0 0-.79-1.1 1.2 1.2 0 0 0-1.32.24l-.05.04a1.4 1.4 0 1 1-1.98-1.98l.04-.05a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.73H1.2a1.4 1.4 0 1 1 0-2.8h.07a1.2 1.2 0 0 0 1.1-.79 1.2 1.2 0 0 0-.24-1.32l-.04-.05a1.4 1.4 0 1 1 1.98-1.98l.05.04a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .73-1.1V1.2a1.4 1.4 0 1 1 2.8 0v.07a1.2 1.2 0 0 0 .73 1.1h.06a1.2 1.2 0 0 0 1.32-.24l.05-.04a1.4 1.4 0 1 1 1.98 1.98l-.04.05a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.73h.13a1.4 1.4 0 1 1 0 2.8h-.07a1.2 1.2 0 0 0-1.1.73z" />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Icon>
);
