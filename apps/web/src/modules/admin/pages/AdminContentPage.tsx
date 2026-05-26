import { FormEvent, useEffect, useState } from "react";
import {
  adminApi,
  type AdminStaticContent,
} from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AdminContentPage() {
  usePageTitle("Admin — Content");
  const [rows, setRows] = useState<AdminStaticContent[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    adminApi
      .contentList()
      .then((items) => {
        setRows(items);
        if (!selectedKey && items.length > 0) {
          setSelectedKey(items[0].key);
          setValue(items[0].value);
        }
      })
      .catch((err) => setMessage(String(err)));

  useEffect(() => {
    load();
  }, []);

  const chooseRow = (row: AdminStaticContent) => {
    setSelectedKey(row.key);
    setValue(row.value);
    setMessage(null);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const key = selectedKey.trim();
    if (!key) return;

    try {
      const saved = await adminApi.contentUpsert(key, value);
      setMessage(`Saved ${saved.key}`);
      await load();
      setSelectedKey(saved.key);
      setValue(saved.value);
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <div className="admin-page">
      <header className="page-header admin-page-header">
        <div>
          <h1>Static content</h1>
          <p className="muted">
            Edit key/value copy used by the public marketing pages.
          </p>
        </div>
      </header>

      <div className="admin-content-grid">
        <table className="sip-table admin-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <button
                    type="button"
                    className="admin-inline-button"
                    onClick={() => chooseRow(row)}
                  >
                    {row.key}
                  </button>
                </td>
                <td className="muted">
                  {new Date(row.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form className="home-form admin-content-form" onSubmit={save}>
          <label>
            Content key
            <input
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              placeholder="about.mission"
              required
            />
          </label>
          <label>
            Value
            <textarea
              rows={8}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="dtp-btn dtp-btn--primary">
            Save content
          </button>
          {message && <p className="muted">{message}</p>}
        </form>
      </div>
    </div>
  );
}
