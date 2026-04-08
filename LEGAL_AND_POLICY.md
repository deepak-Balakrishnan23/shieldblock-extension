# Legal And Policy Notes

- ShieldBlock is designed to block ads, trackers, overlays, and intrusive UI, not to bypass paywalls or unlock authenticated content.
- Chrome Web Store compliance:
  - keep all executable code bundled in the extension package
  - clearly justify `<all_urls>` and blocking permissions in the store listing
  - disclose that processing is local-only and no browsing data is transmitted
- Mozilla Add-ons compliance:
  - declare no data collection in `browser_specific_settings.gecko.data_collection_permissions`
  - keep privacy policy language aligned with actual runtime behavior
- Filter-list licensing:
  - review and retain attribution/license requirements for any imported third-party filter sources before distribution
- Maintenance:
  - YouTube-specific fixes should be reviewed regularly to avoid breakage or store-policy issues caused by overly aggressive player manipulation
