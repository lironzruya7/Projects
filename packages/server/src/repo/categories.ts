import { getDb } from '../db/db.js';

export interface Category {
  name: string;
  display_order: number;
  color: string | null;
  is_builtin: number;
}

export function listCategories(): Category[] {
  return getDb().prepare(`SELECT * FROM categories ORDER BY display_order, name`).all() as Category[];
}

export function addCategory(name: string, color?: string): void {
  const max = getDb().prepare(`SELECT COALESCE(MAX(display_order), 0) AS m FROM categories`).get() as {
    m: number;
  };
  getDb()
    .prepare(`INSERT OR IGNORE INTO categories (name, display_order, color, is_builtin) VALUES (?, ?, ?, 0)`)
    .run(name, max.m + 10, color ?? null);
}

export function renameCategory(oldName: string, newName: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO categories (name, display_order, color, is_builtin)
                SELECT ?, display_order, color, is_builtin FROM categories WHERE name = ?`).run(newName, oldName);
    db.prepare(`UPDATE transactions SET category = ? WHERE category = ?`).run(newName, oldName);
    db.prepare(`UPDATE category_rules SET category = ? WHERE category = ?`).run(newName, oldName);
    db.prepare(`DELETE FROM categories WHERE name = ? AND name <> ?`).run(oldName, newName);
  });
  tx();
}

export function deleteCategory(name: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE transactions SET category = NULL, category_source = 'none' WHERE category = ?`).run(name);
    db.prepare(`DELETE FROM category_rules WHERE category = ?`).run(name);
    db.prepare(`DELETE FROM categories WHERE name = ? AND is_builtin = 0`).run(name);
  });
  tx();
}

export function setCategoryColor(name: string, color: string): void {
  getDb().prepare(`UPDATE categories SET color = ? WHERE name = ?`).run(color, name);
}
