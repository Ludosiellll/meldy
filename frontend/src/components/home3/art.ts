/**
 * The author's own picture of the example test «Эластичность спроса»: a demand and supply graph on squared paper,
 * as a teacher would photograph a board or draw one. One SVG, used as the cover, the picture block and the page
 * background in the reel and in the small studio on the page (no file to fetch). The drawing keeps to the middle
 * band (y 70–290 of 360), so a 5:2 cover crop keeps every label.
 */
const GRAPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#d9e2ef" stroke-width="1"/></pattern></defs>
<rect width="640" height="360" fill="#f4f7fb"/><rect width="640" height="360" fill="url(#g)"/>
<path d="M120 70V282H560" fill="none" stroke="#0b121c" stroke-width="4" stroke-linecap="round"/>
<path d="M150 92C250 158 360 212 520 256" fill="none" stroke="#2869dd" stroke-width="6" stroke-linecap="round"/>
<path d="M160 262C270 218 380 152 510 92" fill="none" stroke="#0b121c" stroke-width="6" stroke-linecap="round"/>
<path d="M120 186H321M321 186V282" fill="none" stroke="#0b121c" stroke-width="2.5" stroke-dasharray="7 8"/>
<circle cx="321" cy="186" r="11" fill="#f4c45b" stroke="#0b121c" stroke-width="3"/>
<g font-family="Onest, Arial, sans-serif" font-weight="600" font-size="26" fill="#0b121c">
<text x="88" y="92">P</text><text x="572" y="290">Q</text><text x="530" y="252" fill="#2869dd">D</text><text x="520" y="100">S</text>
</g></svg>`;

export const GRAPH_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(GRAPH)}`;

/** The author's own page background: a sheet of a notebook with a few lines of notes (light, so the cards read). */
const PAPER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 900">
<rect width="640" height="900" fill="#f6efe0"/>
<g stroke="#d9cdb3" stroke-width="2">${Array.from({ length: 28 }, (_, i) => `<path d="M0 ${60 + i * 30}H640"/>`).join('')}</g>
<path d="M72 0V900" stroke="#e7a9a0" stroke-width="2.5"/>
<g fill="none" stroke="#33465f" stroke-width="3" stroke-linecap="round" opacity=".55">
<path d="M110 132c30-14 60 14 90 0s60-14 90 0"/><path d="M110 222h220"/><path d="M110 312c40-10 80 10 120 0"/>
<path d="M110 582c36-12 70 12 104 0s66-12 100 0"/><path d="M110 672h160"/></g></svg>`;

export const PAPER_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PAPER)}`;
