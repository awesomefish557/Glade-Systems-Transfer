export function SvgRoughDefs() {
  return (
    <div style={{ position: "fixed", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }} aria-hidden>
      <svg width="0" height="0">
        <defs>
          <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
