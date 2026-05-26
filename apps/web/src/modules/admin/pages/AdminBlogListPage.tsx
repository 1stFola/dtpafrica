import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminBlogPost } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AdminBlogListPage() {
  usePageTitle("Admin — Blog");
  const [posts, setPosts] = useState<AdminBlogPost[]>([]);

  const load = () => adminApi.blogList().then(setPosts).catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const togglePublish = async (post: AdminBlogPost) => {
    await adminApi.blogPublish(post.id, !post.isPublished);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this post?")) return;
    await adminApi.blogDelete(id);
    load();
  };

  return (
    <div className="admin-page">
      <header className="page-header admin-page-header">
        <div>
          <h1>Blog</h1>
          <p className="muted">Draft and publish posts to /blog</p>
        </div>
        <Link to="/admin/blog/new" className="dtp-btn dtp-btn--primary">
          New post
        </Link>
      </header>

      <table className="sip-table admin-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Slug</th>
            <th>Status</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id}>
              <td>
                <Link to={`/admin/blog/${post.id}`} className="text-link">
                  {post.title}
                </Link>
              </td>
              <td className="muted">{post.slug}</td>
              <td>
                <button
                  type="button"
                  className={
                    post.isPublished ? "admin-pill admin-pill--live" : "admin-pill"
                  }
                  onClick={() => togglePublish(post)}
                >
                  {post.isPublished ? "Published" : "Draft"}
                </button>
              </td>
              <td className="muted">
                {new Date(post.updatedAt).toLocaleDateString()}
              </td>
              <td>
                {post.isPublished && (
                  <Link to={`/blog/${post.slug}`} className="text-link" target="_blank">
                    View
                  </Link>
                )}{" "}
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
    </div>
  );
}
