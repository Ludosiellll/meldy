/**
 * The ids that aria-controls names but the document does not have (QA 2026-10-07: «Как считается»
 * pointed at its panel while the panel was not rendered). A test expects none.
 */
export function danglingControls(root: ParentNode = document): string[] {
  return Array.from(root.querySelectorAll('[aria-controls]')).flatMap((element) =>
    (element.getAttribute('aria-controls') ?? '')
      .split(/\s+/)
      .filter((id) => id !== '' && !document.getElementById(id)),
  );
}
