import { beforeEach, describe, expect, it } from "vitest";
import { listCategories } from "../../../../src/contexts/finance/application/list-categories";
import { createCategory } from "../../../../src/contexts/finance/application/create-category";
import { updateCategory } from "../../../../src/contexts/finance/application/update-category";
import { FinanceCategoryNotFound, InvalidFinanceInputError } from "../../../../src/contexts/finance/domain/errors";
import { InMemoryFinanceCategoryRepository } from "../fakes";

let repo: InMemoryFinanceCategoryRepository;

beforeEach(() => {
  repo = new InMemoryFinanceCategoryRepository();
});

describe("listCategories", () => {
  it("seeds and returns the defaults on first call", async () => {
    const categories = await listCategories(repo, "user-1");
    expect(categories).toHaveLength(11);
  });

  it("does not re-seed on a second call", async () => {
    await listCategories(repo, "user-1");
    const categories = await listCategories(repo, "user-1");
    expect(categories).toHaveLength(11);
  });
});

describe("createCategory", () => {
  it("creates a category with defaults for icon and sort_order", async () => {
    const category = await createCategory(repo, { userId: "user-1", name: "副業", type: "income" });
    expect(category).toMatchObject({ name: "副業", type: "income", icon: "other", sortOrder: 0, archived: false });
  });

  it("rejects an unknown type", async () => {
    await expect(
      createCategory(repo, { userId: "user-1", name: "test", type: "savings" as never }),
    ).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("rejects a duplicate name for the same user + type as 400, not a thrown DB conflict", async () => {
    await createCategory(repo, { userId: "user-1", name: "副業", type: "income" });
    await expect(createCategory(repo, { userId: "user-1", name: "副業", type: "income" })).rejects.toBeInstanceOf(
      InvalidFinanceInputError,
    );
  });

  it("allows the same name for a different type", async () => {
    await createCategory(repo, { userId: "user-1", name: "其他", type: "income" });
    const expenseOther = await createCategory(repo, { userId: "user-1", name: "其他", type: "expense" });
    expect(expenseOther.name).toBe("其他");
  });

  it("allows the same name for a different user", async () => {
    await createCategory(repo, { userId: "user-1", name: "副業", type: "income" });
    const other = await createCategory(repo, { userId: "user-2", name: "副業", type: "income" });
    expect(other.name).toBe("副業");
  });
});

describe("updateCategory", () => {
  it("updates name/icon/sort_order/archived", async () => {
    const category = await createCategory(repo, { userId: "user-1", name: "副業", type: "income" });
    const updated = await updateCategory(repo, "user-1", category.id, { name: "外快", icon: "cash", sortOrder: 5, archived: true });
    expect(updated).toMatchObject({ name: "外快", icon: "cash", sortOrder: 5, archived: true });
  });

  it("throws FinanceCategoryNotFound for another user's category", async () => {
    const category = await createCategory(repo, { userId: "user-1", name: "副業", type: "income" });
    await expect(updateCategory(repo, "user-2", category.id, { name: "外快" })).rejects.toBeInstanceOf(FinanceCategoryNotFound);
  });

  it("throws FinanceCategoryNotFound for an unknown id", async () => {
    await expect(updateCategory(repo, "user-1", "nope", { name: "外快" })).rejects.toBeInstanceOf(FinanceCategoryNotFound);
  });

  it("rejects renaming to a name that collides with another of the user's categories of the same type", async () => {
    await createCategory(repo, { userId: "user-1", name: "副業", type: "income" });
    const target = await createCategory(repo, { userId: "user-1", name: "獎金外快", type: "income" });
    await expect(updateCategory(repo, "user-1", target.id, { name: "副業" })).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("archiving a category leaves it readable via listCategories (existing transactions keep referencing it)", async () => {
    const category = await createCategory(repo, { userId: "user-1", name: "副業", type: "income" });
    await updateCategory(repo, "user-1", category.id, { archived: true });
    const categories = await listCategories(repo, "user-1");
    expect(categories.find((c) => c.id === category.id)).toMatchObject({ archived: true });
  });
});
