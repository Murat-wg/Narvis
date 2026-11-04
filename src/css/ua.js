// Tarayici varsayilan (user-agent) stilleri. Narvis'in baslangic noktasi.

export const UA_CSS = `
html { display: block; }
head, title, meta, link, style, script, base, template, noscript { display: none; }
body {
  display: block;
  margin: 8px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  color: #1b1f24;
  background-color: #ffffff;
}
article, aside, details, div, figcaption, figure, footer, form, header, hgroup,
main, nav, section, blockquote, dl, dt, dd, fieldset, legend, address, p, pre,
ul, ol, menu, table, hr, body, html,
h1, h2, h3, h4, h5, h6 { display: block; }
p { margin: 1em 0; }
h1 { font-size: 2em; margin: 0.55em 0 0.4em; font-weight: 700; line-height: 1.2; }
h2 { font-size: 1.55em; margin: 0.6em 0 0.35em; font-weight: 700; line-height: 1.25; }
h3 { font-size: 1.25em; margin: 0.6em 0 0.3em; font-weight: 700; line-height: 1.3; }
h4 { font-size: 1.1em; margin: 0.6em 0 0.3em; font-weight: 700; }
h5 { font-size: 1em; margin: 0.6em 0 0.3em; font-weight: 700; }
h6 { font-size: 0.9em; margin: 0.6em 0 0.3em; font-weight: 700; color: #555; }
ul, ol { margin: 1em 0; padding-left: 2em; }
li { display: list-item; margin: 0.2em 0; }
ul { list-style-type: disc; }
ol { list-style-type: decimal; }
dl { margin: 1em 0; }
dt { display: block; font-weight: 600; }
dd { display: block; margin: 0 0 0.5em 1.5em; }
blockquote { margin: 1em 1.5em; padding-left: 1em; border-left: 3px solid #d8dee6; color: #555; }
a { color: #2563eb; text-decoration-line: underline; cursor: pointer; }
a:hover { color: #1d4ed8; }
strong, b { font-weight: 700; }
em, i { font-style: italic; }
small { font-size: 0.85em; }
code, kbd, samp, tt { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.9em; }
pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; white-space: pre; margin: 1em 0; overflow-x: auto; font-size: 0.9em; line-height: 1.5; }
img { display: inline-block; }
hr { border: 0; border-top: 1px solid #d8dee6; margin: 1.2em 0; height: 0; }
figure { margin: 1em 0; }
figcaption { font-size: 0.9em; color: #666; }
button, input, select, textarea { font: inherit; font-size: 0.95em; }
button {
  display: inline-block; padding: 0.45em 0.95em; background-color: #f1f5f9;
  border: 1px solid #cbd5e1; border-radius: 7px; color: #0f172a; text-align: center; cursor: pointer;
}
input, textarea { display: inline-block; padding: 0.4em 0.55em; background-color: #fff; border: 1px solid #cbd5e1; border-radius: 6px; }
table { display: table; border-collapse: separate; border-spacing: 2px; }
caption { display: table-caption; }
thead, tbody, tfoot { display: table-row-group; }
tr { display: table-row; }
td, th { display: table-cell; vertical-align: top; padding: 1px; }
th { font-weight: 700; text-align: center; }
col, colgroup { display: none; }
input, button, textarea, select { display: inline-block; box-sizing: border-box; }
button, input[type=submit], input[type=reset], input[type=button] {
  border: 1px solid #767676; border-radius: 3px; background-color: #efefef;
  padding: 2px 8px; color: #1b1f24; font-size: 14px; cursor: default;
}
input, textarea {
  border: 1px solid #767676; background-color: #fff;
  color: #1b1f24; font-family: inherit; font-size: 14px; padding: 2px 4px;
}
textarea { white-space: pre-wrap; }
select {
  border: 1px solid #767676; border-radius: 3px; background-color: #fff;
  color: #1b1f24; font-family: inherit; font-size: 14px;
  padding: 2px 24px 2px 6px; cursor: pointer;
}
select[multiple] { padding: 2px 6px; cursor: default; }
select:disabled { color: #757575; background-color: #f2f2f2; cursor: default; }
input[type=checkbox], input[type=radio] { border: 0; background: none; padding: 0; cursor: pointer; }
input[type=hidden] { display: none !important; }
option, optgroup { display: none; }
[hidden] { display: none !important; }
`;
