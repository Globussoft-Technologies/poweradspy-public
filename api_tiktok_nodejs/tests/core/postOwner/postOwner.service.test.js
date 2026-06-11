import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: Branch coverage caps at ~94% due to the same unreachable
// redundant `!dataFind` guard pattern as countryAge/countryGender on
// line 89 (preceded by `if (dataFind) return` early-exit).

const {
  createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy,
  createValidateSpy, updateValidateSpy, loggerErrorSpy,
} = vi.hoisted(() => ({
  createSpy: vi.fn(),
  findOneSpy: vi.fn(),
  findAllSpy: vi.fn(),
  updateSpy: vi.fn(),
  destroySpy: vi.fn(),
  createValidateSpy: vi.fn(),
  updateValidateSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_post_owners: {
      create: createSpy,
      findOne: findOneSpy,
      findAll: findAllSpy,
      update: updateSpy,
      destroy: destroySpy,
    },
  },
}));

vi.mock("../../../core/postOwner/postOwner.validation.js", () => ({
  default: {
    createOwnerDetails: createValidateSpy,
    updateOwnerDetails: updateValidateSpy,
  },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("config", () => ({ default: { get: vi.fn((k) => `cfg:${k}`) } }));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [createSpy, findOneSpy, findAllSpy, updateSpy, destroySpy, createValidateSpy, updateValidateSpy, loggerErrorSpy])
    s.mockReset();
  ({ default: svc } = await import(
    "../../../core/postOwner/postOwner.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("postOwner.service > createPostOwner", () => {
  it("returns VALIDATION_FAIL when validation errors", async () => {
    createValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.createPostOwner({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("inserts when no existing row matches", async () => {
    createValidateSpy.mockReturnValueOnce({ value: { post_owner: "A" }, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    createSpy.mockResolvedValueOnce({ id: 1, post_owner: "A" });
    const res = mockRes();
    await svc.createPostOwner({ body: {} }, res);
    expect(createSpy).toHaveBeenCalledWith({ post_owner: "A" });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "New post_owner inserted successfully"
    );
  });

  it("updates + re-fetches when existing row matches", async () => {
    createValidateSpy.mockReturnValueOnce({ value: { post_owner: "A" }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 }); // exists
    updateSpy.mockResolvedValueOnce([1]);
    findOneSpy.mockResolvedValueOnce({ id: 1, post_owner: "A_updated" });
    const res = mockRes();
    await svc.createPostOwner({ body: {} }, res);
    expect(updateSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "post_owner updated successfully"
    );
  });

  it("catches error and returns failure response", async () => {
    createValidateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.createPostOwner({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to add post_owner details"
    );
  });
});

describe("postOwner.service > updatePostOwner", () => {
  it("returns VALIDATION_FAIL when validation errors", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: { message: "bad" } });
    const res = mockRes();
    await svc.updatePostOwner({ params: { postownerid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("VALIDATION_FAIL");
  });

  it("returns 'Invalid post owner ID' when row not found", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updatePostOwner({ params: { postownerid: 99 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid post owner ID");
  });

  it("updates and returns success when row exists", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: { post_owner: "X" }, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce([1]);
    const res = mockRes();
    await svc.updatePostOwner({ params: { postownerid: 1 }, body: { post_owner: "X" } }, res);
    expect(updateSpy).toHaveBeenCalledWith({ post_owner: "X" }, { where: { id: 1 } });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "post owner data updated successfully"
    );
  });

  it("does not respond when update resolves falsy", async () => {
    updateValidateSpy.mockReturnValueOnce({ value: {}, error: undefined });
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    updateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updatePostOwner({ params: { postownerid: 1 }, body: {} }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    updateValidateSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await svc.updatePostOwner({ params: { postownerid: 1 }, body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to update post owner data."
    );
  });
});

describe("postOwner.service > getAllPostOwner", () => {
  it("returns success when findAll resolves with rows", async () => {
    findAllSpy.mockResolvedValueOnce([{ id: 1 }]);
    const res = mockRes();
    await svc.getAllPostOwner({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Country gender info fetched successfully"
    );
  });

  it("does not respond when findAll resolves falsy", async () => {
    findAllSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getAllPostOwner({}, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getAllPostOwner({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch Country gender."
    );
  });
});

describe("postOwner.service > getPostOwner", () => {
  it("returns success when row is found", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 7 });
    const res = mockRes();
    await svc.getPostOwner({ params: { postownerid: 7 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Post owner info fetched successfully"
    );
  });

  it("returns 'No data Found' when no row matches", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getPostOwner({ params: { postownerid: 9 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("returns 'No data Found' when postownerid is missing", async () => {
    const res = mockRes();
    await svc.getPostOwner({ params: {} }, res);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe("No data Found");
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getPostOwner({ params: { postownerid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch post owner with this postowner id."
    );
  });
});

describe("postOwner.service > deletePostOwner", () => {
  it("deletes and returns success when row exists", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(1);
    const res = mockRes();
    await svc.deletePostOwner({ params: { postownerid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "post owner id deleted successfully"
    );
  });

  it("returns 'Invalid post owner ID' when row not found", async () => {
    findOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deletePostOwner({ params: { postownerid: 99 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Invalid post owner ID");
  });

  it("does not respond when destroy returns falsy 0", async () => {
    findOneSpy.mockResolvedValueOnce({ id: 1 });
    destroySpy.mockResolvedValueOnce(0);
    const res = mockRes();
    await svc.deletePostOwner({ params: { postownerid: 1 } }, res);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("catches error and returns failure response", async () => {
    findOneSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.deletePostOwner({ params: { postownerid: 1 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to delete post owner Id."
    );
  });
});
