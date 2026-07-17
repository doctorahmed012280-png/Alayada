/* ============================================================
   SHARED APP STATE
   `me` (the signed-in staff member) and `unsubs` (active realtime
   listeners) are read and written from several feature modules, so
   they live in one shared, mutable object instead of separate
   global variables.
   ============================================================ */
export const state = {
  me: null,      // { uid, tenantId, role, branchId, name, email }
  unsubs: []      // active realtime listeners, torn down on logout/nav
};
