import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, type BlogPostSummary } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { contentValue, useStaticContent } from "../../../hooks/useStaticContent";

const categories = ["All", "Insights", "Success stories", "Expert tips"] as const;

function classifyPost(post: BlogPostSummary) {
  const text = `${post.title} ${post.excerpt ?? ""}`.toLowerCase();
  if (text.includes("rating") || text.includes("system")) return "Expert tips";
  if (text.includes("dream") || text.includes("trap") || text.includes("scouting")) return "Insights";
  return "Success stories";
}

export function BlogPage() {
  usePageTitle("Blog");
  const content = useStaticContent(["blog.hero.kicker", "blog.hero.title", "blog.hero.body"]);
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [active, setActive] = useState<(typeof categories)[number]>("All");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<BlogPostSummary[]>("/home/blog")
      .then(setPosts)
      .catch((e) => setError(String(e)));
  }, []);

  const filtered = useMemo(
    () => (active === "All" ? posts : posts.filter((post) => classifyPost(post) === active)),
    [active, posts]
  );
  const featured = filtered[0];
  const rest = filtered.slice(1);

  return (
    <main className="home-page evidence-page evidence-page--blog blog-premium">
      <header className="evidence-hero blog-hero">
        <span className="about-kicker">{contentValue(content, "blog.hero.kicker", "DTP Africa Blog")}</span>
        <h1>{contentValue(content, "blog.hero.title", "Football intelligence deserves a stronger public record.")}</h1>
        <p>
          {contentValue(
            content,
            "blog.hero.body",
            "Practical thinking on football development, transparent scouting, player protection, data-led evaluation, and the future of African talent discovery."
          )}
        </p>
        <div className="evidence-hero__signals" aria-label="Editorial focus">
          <span>Scouting context</span>
          <span>Player protection</span>
          <span>Evidence-led development</span>
        </div>
      </header>

      <div className="blog-filters" role="tablist" aria-label="Blog categories">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={category === active ? "active" : ""}
            onClick={() => setActive(category)}
          >
            {category}
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {featured ? (
        <>
          <Link to={`/blog/${featured.slug}`} className="blog-featured">
            <div>
              <span>{classifyPost(featured)}</span>
              <h2>{featured.title}</h2>
              {featured.excerpt && <p>{featured.excerpt}</p>}
              <time>{new Date(featured.publishedAt).toLocaleDateString()}</time>
            </div>
            <strong>Read article</strong>
          </Link>

          <section className="blog-card-grid">
            {rest.map((post) => (
              <Link to={`/blog/${post.slug}`} className="blog-card" key={post.id}>
                <span>{classifyPost(post)}</span>
                <h3>{post.title}</h3>
                {post.excerpt && <p>{post.excerpt}</p>}
                <time>{new Date(post.publishedAt).toLocaleDateString()}</time>
              </Link>
            ))}
          </section>
        </>
      ) : (
        <div className="blog-empty">
          <h2>No posts published yet</h2>
          <p>Fresh DTP Africa insights will appear here once published.</p>
        </div>
      )}
    </main>
  );
}
