Brief update for clients
**Date:** 2026-04-24
*Plain-language summary*

We recently improved **multi-account mail**, **Sent / Trash folders**, and **reading reliability**. In simple terms:

1. **“All accounts” works for every inbox**  
   When you use the **All accounts** view, **Inbox, Sent, and Trash** (and similar folders) are loaded **for each signed-in Google account**, not only the primary one.

2. **Linked / secondary accounts open correctly**  
   Fixed cases where opening a message showed **“message not found”**; the app now uses the **correct mailbox** for reading, starring, and deleting.

3. **After you delete mail, other messages still open**  
   Fixed an issue where, after deleting in Trash, **other messages in the same folder** could fail to open. Background refresh now **follows the folder you are viewing** (e.g. stays on Trash) instead of mixing in Inbox data by mistake.

4. **Housekeeping**  
   Removed **duplicate code** introduced by a bad merge to avoid crashes, and refreshed the **internal handover document** for the development team.

