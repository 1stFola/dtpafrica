import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@dtp/ui";
import { adminApi } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AdminBlogEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [body, setBody] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  usePageTitle(isNew ? "New post" : "Edit post");

  useEffect(() => {
    if (isNew || !id) return;
    adminApi.blogGet(id).then((post) => {
      setTitle(post.title);
      setSlug(post.slug);
      setExcerpt(post.excerpt ?? "");
      setBody(post.body);
      setIsPublished(post.isPublished);
    });
  }, [id, isNew]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const payload = {
      title,
      slug: slug || undefined,
      excerpt,
      body,
      isPublished,
    };
    try {
      if (isNew) {
        const created = await adminApi.blogCreate(payload);
        navigate(`/admin/blog/${created.id}`, { replace: true });
      } else if (id) {
        await adminApi.blogUpdate(id, payload);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-page">
      <Link to="/admin/blog" className="back-link">
        ← Blog
      </Link>
      <h1>{isNew ? "New post" : "Edit post"}</h1>
      <form className="home-form admin-blog-form" onSubmit={onSubmit}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Slug (optional)
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-from-title" />
        </label>
        <label>
          Excerpt
          <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} />
        </label>
        <label>
          Body
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} required />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
          />
          Publish immediately
        </label>
        {error && <p className="form-error">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save"}
        </Button>
      </form>
    </div>
  );
}
