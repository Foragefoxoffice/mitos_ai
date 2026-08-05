// Only the core backend is allowed to call this service — verified via a
// shared secret header, not a user JWT. ai-service is never reachable from
// clients directly (see docs/MITOS_AI_Platform_Implementation_Plan_REVISED.md).
const verifyInternalService = (req, res, next) => {
  const key = req.header("x-internal-key");

  if (!key || key !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
};

module.exports = { verifyInternalService };
