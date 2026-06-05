import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, type BlogPost } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

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
      <div className="home-page">
        <p className="form-error">{error}</p>
        <Link to="/blog">Back to blog</Link>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="home-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <article className="home-page blog-article">
      <Link to="/blog" className="back-link">
        ← Blog
      </Link>
      <header className="page-header">
        <time className="muted">{new Date(post.publishedAt).toLocaleDateString()}</time>
        <h1>{post.title}</h1>
      </header>
      <div className="blog-body">
        {post.body.split("\n\n").map((para) => (
          <p key={para.slice(0, 24)}>{para}</p>
        ))}
      </div>
    </article>
  );
}
