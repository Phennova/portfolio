# Phennova portfolio

Minimal static portfolio on GitHub Pages. Edit mode lets the owner add projects, images, descriptions and timeline
entries, and switch layouts (grid / list / minimal), straight from the browser.

How editing works: the page commits changes to `data/site.json` and `images/` through the GitHub API using a
fine-grained token limited to this repo (Contents: read/write). The token is stored AES-GCM encrypted
(PBKDF2-SHA256, 600k iterations) in `data/auth.json`; the owner's password is the key. Use a long password: anyone can
download the encrypted file and guess offline. Worst case with a repo-scoped token is changes to this repo.
