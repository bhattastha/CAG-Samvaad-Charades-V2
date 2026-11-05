/** Static 3D metal badge (same look as the web Badge3D) for the printable certificate. */
const METAL: Record<string, { hi: string; base: string; lo: string; rim: string; face: string; ribbon: string; numeral: string; metal: string; royal?: boolean }> = {
  trial: { hi: "#F3C08A", base: "#CD7F32", lo: "#7A4A1E", rim: "#5C3714", face: "#E8A866", ribbon: "#1E3A5F", numeral: "I", metal: "Bronze" },
  primary: { hi: "#FFFFFF", base: "#C0C0C0", lo: "#7D7D7D", rim: "#5E5E5E", face: "#E6E6E6", ribbon: "#1E3A5F", numeral: "II", metal: "Silver" },
  secondary: { hi: "#FFF1A8", base: "#D4A017", lo: "#8A6500", rim: "#6B4E00", face: "#F5CF4A", ribbon: "#1E3A5F", numeral: "III", metal: "Gold" },
  pro: { hi: "#FFFFFF", base: "#E5E4E2", lo: "#A9B4BE", rim: "#6F7C88", face: "#F4F6F8", ribbon: "#1E3A5F", numeral: "IV", metal: "Platinum" },
  varchaspati: { hi: "#B794F6", base: "#6D28D9", lo: "#3B0F7A", rim: "#D4A017", face: "#F5CF4A", ribbon: "#D4A017", numeral: "V", metal: "Royal", royal: true },
};
export const badgeMetal = (k: string) => METAL[k]?.metal ?? "";

const SHIELD = "M32 4l22 7.5v15c0 15-9.3 27.2-22 32.8C19.3 53.7 10 41.5 10 26.5V11.5z";
const FACE = "M32 9.4l17 5.8v11.4c0 11.8-7.2 21.4-17 26C22.2 48 15 38.4 15 26.6V15.2z";

export function badgeSvg(k: string, sizeMm = 34): string {
  const m = METAL[k] ?? METAL.trial!;
  const n = m.numeral;
  const fs = n.length >= 3 ? 15 : n.length === 2 ? 18 : 21;
  const g = m.royal ? ` transform="translate(4.5 8.5) scale(.86)"` : "";
  const rim = m.royal ? ["#FFE58A", "#D4A017", "#7A5A0E"] : [m.hi, m.base, m.lo];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${sizeMm}mm" height="${sizeMm}mm" style="overflow:visible;filter:drop-shadow(0 1.2mm 2.6mm rgba(0,0,0,.25))">
<defs>
<linearGradient id="cr" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="${rim[0]}"/><stop offset=".45" stop-color="${rim[1]}"/><stop offset="1" stop-color="${rim[2]}"/></linearGradient>
<linearGradient id="cf" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="${m.hi}"/><stop offset=".55" stop-color="${m.base}"/><stop offset="1" stop-color="${m.lo}"/></linearGradient>
<linearGradient id="cn" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="${m.face}"/><stop offset="1" stop-color="${m.royal ? "#B8860B" : m.base}"/></linearGradient>
<linearGradient id="cs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".85"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="cc"><path d="${SHIELD}"/></clipPath>
</defs>
<g${g}><path d="M20 46l-5 17 6-3.2 4 4.2 4.5-14z" fill="${m.ribbon}"/><path d="M44 46l5 17-6-3.2-4 4.2-4.5-14z" fill="${m.ribbon}"/><path d="M20 46l-5 17 6-3.2z" fill="#000" opacity=".22"/></g>
${m.royal ? `<path d="M22.5 9.2l1.6-6.4 4.3 3.6L32 .8l3.6 5.6 4.3-3.6 1.6 6.4z" fill="url(#cr)" stroke="#7A5A0E" stroke-width=".6"/><rect x="22.5" y="8.4" width="19" height="2.4" rx=".8" fill="#B8860B"/>` : ""}
<g${g}>
<path d="${SHIELD}" fill="url(#cr)" stroke="${m.rim}" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M11.6 12.6L32 5.6l20.4 7" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1" stroke-linecap="round"/>
<path d="${FACE}" fill="url(#cf)"/><path d="${FACE}" fill="none" stroke="${m.rim}" stroke-opacity=".55" stroke-width=".6"/>
<g font-family="'Noto Serif',Georgia,serif" font-weight="800" font-size="${fs}" text-anchor="middle">
<text x="33" y="37.9" fill="${m.royal ? "#3B0F7A" : m.rim}" opacity=".9">${n}</text><text x="31.4" y="36.2" fill="#fff" opacity=".75">${n}</text>
<text x="32" y="36.9" fill="url(#cn)" stroke="${m.rim}" stroke-width=".9" paint-order="stroke">${n}</text></g>
<g clip-path="url(#cc)"><path d="M8 26C16 12 30 6 46 6l-2 5C30 12 20 18 13 30z" fill="url(#cs)" opacity=".75"/><path d="${SHIELD}" fill="#000" opacity=".12" transform="translate(5 6)"/></g>
</g></svg>`;
}
