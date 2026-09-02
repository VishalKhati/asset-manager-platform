import { Router, type IRouter } from "express";
import healthRouter        from "./health.js";
import botRouter           from "./bot.js";
import authRouter          from "./auth.js";
import adminRouter         from "./admin.js";
import notificationsRouter from "./notifications.js";
import alertsRouter        from "./alerts.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth",          authRouter);
router.use("/bot",           botRouter);
router.use("/admin",         adminRouter);
router.use("/notifications", notificationsRouter);
router.use("/alerts",        alertsRouter);

export default router;
