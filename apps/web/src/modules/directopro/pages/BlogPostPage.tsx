import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, type BlogPost } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

function renderInline(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part) =>
    /^https?:\/\//.test(part) ? (
      <a key={part} href={part} target="_blank" rel="noreferrer">
        {part.replace(/^https?:\/\//, "")}
      </a>
    ) : (
      part
    )
  );
}

function ArticleBlock({ block }: { block: string }) {
  const trimmed = block.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const isList = lines.every((line) => /^[-•]\s+/.test(line) || /^\d+\)/.test(line));

  if (isList) {
    return (
      <ul>
        {lines.map((line) => (
          <li key={line}>{renderInline(line.replace(/^[-•]\s+/, "").replace(/^\d+\)\s+/, ""))}</li>
        ))}
      </ul>
    );
  }

  if (lines.length === 1 && first.length < 95 && !first.endsWith(".")) {
    return <h2>{first}</h2>;
  }

  return <p>{renderInline(lines.join(" "))}</p>;
}

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(post?.title);

  useEffect(() => {
    if (!slug) return;
    apiGet<BlogPost>(`/home/blog/${slug}`)
      .then(setPost)
      .catch((e) => setError(String(e)));
  }, [slug]);

  if (error) {
    return (
      <div className="home-page blog-article-shell">
        <p className="form-error">{error}</p>
        <Link to="/blog">Back to blog</Link>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="home-page blog-article-shell">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  return (
    <article className="home-page blog-article-shell">
      <Link to="/blog" className="back-link">
        Back to Blog
      </Link>
      <header className="blog-article-hero">
        <span className="about-kicker">DTP Africa Insight</span>
        <time>{new Date(post.publishedAt).toLocaleDateString()}</time>
        <h1>{post.title}</h1>
        {post.excerpt && <p>{post.excerpt}</p>}
      </header>
      <div className="blog-body blog-body--premium">
        {post.body.split(/\n{2,}/).map((block, index) => (
          <ArticleBlock key={`${index}-${block.slice(0, 18)}`} block={block} />
        ))}
      </div>
    </article>
  );
}
