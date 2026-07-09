import { createEvlog } from "evlog/next";
import { createInstrumentation } from "evlog/next/instrumentation/create";

export const {
	withEvlog,
	useLogger: getLogger,
	log,
	createError,
} = createEvlog({
	service: "mercury-web",
});

export const { register, onRequestError } = createInstrumentation({
	service: "mercury-web",
});
