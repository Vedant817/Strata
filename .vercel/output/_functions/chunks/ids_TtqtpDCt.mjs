import { customAlphabet } from "nanoid";
//#region src/lib/ids.ts
/** Short, URL-safe, and sortable-ish enough for our purposes. Prefixed by entity
*  type so an id in a log line is self-describing. */
var raw = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 14);
function nanoid() {
	return raw();
}
//#endregion
export { nanoid as t };
