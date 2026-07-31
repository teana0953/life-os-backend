import { beforeEach, describe, expect, it } from "vitest";
import { ensureDefaultCategories } from "../../../../src/contexts/finance/application/ensure-default-categories";
import { InMemoryFinanceCategoryRepository } from "../fakes";

let repo: InMemoryFinanceCategoryRepository;

beforeEach(() => {
  repo = new InMemoryFinanceCategoryRepository();
});

describe("ensureDefaultCategories", () => {
  it("seeds the 7 expense + 4 income defaults for a user with none", async () => {
    await ensureDefaultCategories(repo, "user-1");
    const categories = await repo.listByUser("user-1");
    expect(categories).toHaveLength(11);
    expect(categories.filter((c) => c.type === "expense")).toHaveLength(7);
    expect(categories.filter((c) => c.type === "income")).toHaveLength(4);
    expect(categories.map((c) => c.name)).toContain("餐飲");
    expect(categories.map((c) => c.name)).toContain("薪資");
  });

  it("is idempotent: calling twice does not duplicate", async () => {
    await ensureDefaultCategories(repo, "user-1");
    await ensureDefaultCategories(repo, "user-1");
    const categories = await repo.listByUser("user-1");
    expect(categories).toHaveLength(11);
  });

  it("does not seed for a user who already has a category (even a non-default one)", async () => {
    await repo.create({ userId: "user-1", name: "custom", type: "expense" });
    await ensureDefaultCategories(repo, "user-1");
    const categories = await repo.listByUser("user-1");
    expect(categories).toHaveLength(1);
  });

  it("does not seed for a user whose only category is archived", async () => {
    const created = await repo.create({ userId: "user-1", name: "custom", type: "expense" });
    await repo.update("user-1", created.id, { archived: true });
    await ensureDefaultCategories(repo, "user-1");
    const categories = await repo.listByUser("user-1");
    expect(categories).toHaveLength(1);
  });

  it("seeding one user does not affect another", async () => {
    await ensureDefaultCategories(repo, "user-1");
    const other = await repo.listByUser("user-2");
    expect(other).toHaveLength(0);
  });
});
