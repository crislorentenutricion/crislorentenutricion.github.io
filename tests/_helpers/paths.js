const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const SITE = path.join(ROOT, "_site");
const BLOG_JSON = path.join(SRC, "_data", "blog.json");
const POSTS_DIR = path.join(SRC, "blog", "posts");
const IMG_BLOG = path.join(SRC, "img", "blog");

module.exports = { ROOT, SRC, SITE, BLOG_JSON, POSTS_DIR, IMG_BLOG };
