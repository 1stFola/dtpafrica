import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminBlogPost } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

export function AdminBlogListPage() {
  usePageTitle("Admin — Blog");
  const toast = useAdminToast();
  const [posts, setPosts] = useState<AdminBlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    adminApi
      .blogList()
      .then(setPosts)
      .catch((e) => {
        toast.error(String(e));
        setPosts([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const togglePublish = async (post: AdminBlogPost) => {
    try {
      await adminApi.blogPublish(post.id, !post.isPublished);
      toast.success(post.isPublished ? "Post unpublished" : "Post published");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this post?")) return;
    try {
      await adminApi.blogDelete(id);
      toast.success("Post deleted");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Blog"
        description="Draft and publish posts to /blog"
        crumbs={[{ label: "Blog" }]}
        actions={
          <Link to="/admin/blog/new" className="admin-inline-button admin-inline-button--primary">
            New post
          </Link>
        }
      />

      <div className="admin-sb-content-panel">
        <AdminTableShell
          loading={loading}
          empty={!loading && posts.length === 0}
          emptyTitle="No blog posts yet"
          emptyHint="Create your first post to publish news on the public site."
          columns={5}
        >
          <table className="admin-table admin-sb-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    <Link to={`/admin/blog/${post.id}`} className="text-link">
                      <strong>{post.title}</strong>
                    </Link>
                  </td>
                  <td>
                    <code className="admin-sb-code">{post.slug}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={
                        post.isPublished
                          ? "admin-sb-status admin-sb-status--active"
                          : "admin-sb-status admin-sb-status--draft"
                      }
                      onClick={() => togglePublish(post)}
                    >
                      {post.isPublished ? "Published" : "Draft"}
                    </button>
                  </td>
                  <td className="muted">
                    {new Date(post.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="admin-table__actions">
                    <Link to={`/admin/blog/${post.id}`} className="admin-link">
                      Edit
                    </Link>
                    {post.isPublished && (
                      <Link to={`/blog/${post.slug}`} className="text-link" target="_blank">
                        View ↗
                      </Link>
                    )}
                    <button
                      type="button"
                      className="admin-link-danger"
                      onClick={() => remove(post.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableShell>
      </div>
    </section>
  );
}
