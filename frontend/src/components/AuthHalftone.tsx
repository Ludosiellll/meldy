/**
 * The halftone of the sign-in pages' coloured panel (legacy.css .au-dots): white dots under the glow at the top right,
 * navy ones at the bottom left, flowing slowly. Two layers, the panel's last children: the glow of each stays, its
 * dots move inside it by a transform (they were the panel's ::before and ::after with a moving background-position,
 * repainted on every frame — smoothness audit 20.10).
 */
export default function AuthHalftone() {
  return (
    <>
      <span className="au-dots au-dots-a" aria-hidden="true">
        <i />
      </span>
      <span className="au-dots au-dots-b" aria-hidden="true">
        <i />
      </span>
    </>
  );
}
