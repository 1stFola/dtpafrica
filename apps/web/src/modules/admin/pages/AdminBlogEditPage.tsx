import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { adminApi } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";

export function AdminBlogEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const navigate = useNavigate();
  const toast = useAdminToast();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [body, setBody] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  usePageTitle(isNew ? "New post" : "Edit post");

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    adminApi
      .blogGet(id)
      .then((post) => {
        setTitle(post.title);
        setSlug(post.slug);
        setExcerpt(post.excerpt ?? "");
        setBody(post.body);
        setIsPublished(post.isPublished);
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false));
  }, [id, isNew, toast]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
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
        toast.success("Post created");
        navigate(`/admin/blog/${created.id}`, { replace: true });
      } else if (id) {
        await adminApi.blogUpdate(id, payload);
        toast.success("Post saved");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title={isNew ? "New post" : "Edit post"}
        description="Write and publish blog content for the public /blog section."
        crumbs={[{ label: "Blog", to: "/admin/blog" }, { label: isNew ? "New" : "Edit" }]}
      />

      {loading ? (
        <div className="admin-sb-panel admin-sb-highlight-form admin-sb-highlight-form--loading" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="admin-sb-skeleton admin-sb-skeleton--field" />
          ))}
        </div>
      ) : (
        <form className="admin-blog-form admin-sb-panel admin-sb-highlight-form" onSubmit={onSubmit}>
          <label className="admin-sb-field admin-sb-field--wide">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="admin-sb-field">
            <span>Slug (optional)</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-from-title"
            />
          </label>
          <label className="admin-sb-field admin-sb-field--wide">
            <span>Excerpt</span>
            <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} />
          </label>
          <label className="admin-sb-field admin-sb-field--wide">
            <span>Body</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} required />
          </label>
          <label className="admin-sb-check">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            Publish immediately
          </label>
          <div className="admin-sb-form-actions admin-sb-sticky-actions">
            <button
              type="submit"
              className="admin-inline-button admin-inline-button--primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save post"}
            </button>
            <Link to="/admin/blog" className="text-link">
              Back to list
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
