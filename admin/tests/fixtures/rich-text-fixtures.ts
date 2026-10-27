export const RICH_TEXT_FIXTURES = [
  {
    name: "figure with caption",
    html: '<figure><img src="/media/p/a.png" alt="a"><figcaption>Caption</figcaption></figure>',
  },
  {
    name: "table with spans and scope",
    html: '<table><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td colspan="2">Value</td></tr></tbody></table>',
  },
  { name: "foreign image", html: '<img src="https://evil/x.png">' },
  { name: "media image", html: '<img src="/media/p/a.png" alt="a">' },
  { name: "script", html: "<script>alert(1)</script>" },
] as const;
