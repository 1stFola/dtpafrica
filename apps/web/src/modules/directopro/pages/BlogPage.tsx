import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, type BlogPostSummary } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function BlogPage() {
  usePageTitle("Blog");
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<BlogPostSummary[]>("/home/blog")
      .then(setPosts)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="home-page">
      <header className="page-header">
        <h1>News & updates</h1>
        <p className="muted">Platform news, pathways, and announcements.</p>
      </header>
      {error && <p className="form-error">{error}</p>}
      <ul className="blog-list">
        {posts.map((post) => (
          <li key={post.id}>
            <Link to={`/blog/${post.slug}`} className="blog-list-item">
              <h3>{post.title}</h3>
              {post.excerpt && <p>{post.excerpt}</p>}
              <time className="muted">
                {new Date(post.publishedAt).toLocaleDateString()}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
