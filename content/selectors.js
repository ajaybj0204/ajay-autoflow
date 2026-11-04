/* Ajay AutoFlow - Google Flow UI selectors (jQuery/Sizzle syntax).
 *
 * v1.1.0 notes
 * - Every value may be a comma list. AWS.q() tries the whole list first and, if one part is
 *   invalid / outdated, falls back to trying each part on its own, so one dead selector never
 *   breaks the others.
 * - Most new Flow controls are ALSO found by text / aria-label / icon matching in flow.js
 *   (see AWS.findClickable), so these selectors are the first try, not the only try.
 * - If Google changes the Flow interface, any key can be overridden from the side panel:
 *   Settings -> Advanced -> Custom selectors (JSON). */
var AWS_DEFAULT_SELECTORS = {
  /* ---------- characters page / scan ---------- */
  charactersTabButton: "mat-list-item:has(mat-icon:contains('accessibility_new')), a[href*='/characters'], button:has(mat-icon:contains('accessibility_new')), [role='tab']:contains('Characters'), mat-list-item:contains('Characters')",
  charactersNameSelector: "flow-character-tile:has(img) span.character-tile-name, flow-character-tile .character-tile-name, flow-character-tile [class*='name'], [class*='character-tile'] [class*='name'], [class*='character-card'] [class*='name']",

  /* ---------- project ---------- */
  createProjectButton: "button:has(mat-icon:contains(\"add_2\")):first(), button:has(mat-icon:contains(\"add\")):first(), button:contains('New project'):first()",
  backProjectButton: "button:has(mat-icon:contains(\"arrow_back\")), a:has(mat-icon:contains(\"arrow_back\")), button[aria-label*='Back'], button:has(span:contains(\"arrow_back\"))",
  selectAllItemMode: "flow-project-nav-list mat-list-item:has(mat-icon:contains(\"dashboard\"))",
  configureUIModeButton: "button:has(mat-icon:contains(\"settings_2\"))",
  selectGridModeOption: "flow-tile-view-settings flow-toggles:eq(0) button:eq(0)",
  selectSizeGridModeOption: "flow-tile-view-settings flow-toggles:eq(1) button:eq(0)",
  selectShowTextModeOption: "flow-tile-view-settings div.toggle-container:eq(2) mat-slide-toggle:has(button[aria-checked=\"false\"])",
  selectClearPromptModeOption: "flow-tile-view-settings div.toggle-container:eq(3) mat-slide-toggle:has(button[aria-checked=\"false\"])",
  closeConfigureUIModeButton: "button:has(mat-icon:contains(\"settings_2\"))",

  /* ---------- prompt box settings ---------- */
  configButton: "div.submit-controls button:has(mat-icon:contains(\"crop\")), div.submit-controls button:has(mat-icon:contains(\"tune\")), flow-prompt-box-settings-button button, button[aria-label*='settings']:has(mat-icon:contains(\"tune\"))",
  configButtonActived: "div.submit-controls button:has(mat-icon:contains(\"crop\")), div.submit-controls button:has(mat-icon:contains(\"tune\")), flow-prompt-box-settings-button button, button[aria-label*='settings']:has(mat-icon:contains(\"tune\"))",

  /* ---------- agent mode (text / aria / icon fallbacks live in flow.js) ---------- */
  agentToggle: "flow-agent-mode-toggle-chip, flow-agent-toggle button, button[aria-label*='Agent'], button[aria-label*='agent'], [role='switch'][aria-label*='Agent'], [role='switch'][aria-label*='agent'], mat-slide-toggle:contains('Agent'), button:contains('Agent'):not(:contains('Agents'))",
  disableAgentModeButton: "flow-agent-mode-toggle-chip.checked, flow-agent-mode-toggle-chip[aria-pressed='true'], button[aria-label*='Agent'][aria-pressed='true'], [role='switch'][aria-label*='Agent'][aria-checked='true'], flow-agent-panel button:has(mat-icon:contains(\"close\")), flow-agent-panel button[aria-label*='Close']",
  enableAgentModeButton: "flow-agent-mode-toggle-chip:not(.checked), flow-agent-mode-toggle-chip[aria-pressed='false'], button[aria-label*='Agent'][aria-pressed='false'], [role='switch'][aria-label*='Agent'][aria-checked='false']",
  agentPanel: "flow-agent-panel, flow-agent-chat, flow-agent-view, [class*='agent-panel'], [class*='agent-chat'], [class*='agent-sidebar']",
  agentSettingsButton: "flow-agent-panel button:has(mat-icon:contains(\"settings\")), flow-agent-panel button:has(mat-icon:contains(\"tune\")), flow-agent-panel button[aria-label*='etting'], [class*='agent-panel'] button[aria-label*='etting']",
  neverAskAgentSettingButton: "flow-settings-view mat-radio-button:eq(1), flow-agent-settings mat-radio-button:contains('Never'), mat-radio-button:contains('Never ask'), mat-radio-button:contains(\"Don't ask\"), [role='radio']:contains('Never')",
  saveAgentSettings: "flow-settings-view button:last(), flow-agent-settings button:contains('Save'), [role='dialog'] button:contains('Save'), [role='dialog'] button:contains('Done')",

  /* ---------- model / mode / ratio / count ---------- */
  modelSelectButton: "flow-prompt-box-settings button:has(mat-icon:contains(\"arrow_drop_down\")), flow-prompt-box-settings button:has(span:contains(\"arrow_drop_down\"))",
  selectVideoMode: "flow-prompt-box-settings button:has(mat-icon:contains(\"videocam\")), flow-prompt-box-settings button:has(span:contains(\"videocam\"))",
  selectImageMode: "flow-prompt-box-settings button:has(mat-icon:contains(\"image\")), flow-prompt-box-settings button:has(span:contains(\"image\"))",
  textToVideoModeOption: "flow-prompt-box-settings button:has(mat-icon:contains(\"chrome_extension\"))",
  imageToVideoModeOption: "flow-prompt-box-settings button:has(mat-icon:contains(\"crop_free\"))",
  componentToVideoModeOption: "flow-prompt-box-settings button:has(mat-icon:contains(\"chrome_extension\"))",
  aspectRatioTemplate: "flow-prompt-box-settings flow-toggles:has(span:contains(\"crop_\")) button:has(mat-icon:contains(\"{aspectRatio}\"))",
  outputCountTemplate: "flow-prompt-box-settings flow-toggles:has(button:contains(\"x4\")) button:contains(\"{outputCount}\")",
  modelItems: "flow-menu-item button, [role='menuitem'], [role='option'], mat-option",
  modelTemplate: "flow-menu-item button:has(span:contains(\"{model}\"))",
  videoLengthTemplate: "flow-prompt-box-settings flow-toggles:has(span:contains(\"8\")) button:has(span:contains(\"{videoLength}\"))",

  /* ---------- prompt box ---------- */
  addImageButton: "flow-base-prompt-box button:has(mat-icon:contains(\"add\")), flow-ingredient-bar button.empty-chip:eq(0), flow-base-prompt-box button[aria-label*='Add'], button[aria-label*='Add media'], button[aria-label*='Add ingredient']",
  promptTextarea: "div[role=\"textbox\"][contenteditable=\"true\"], flow-rich-text-editor [contenteditable=\"true\"], div[contenteditable=\"true\"][aria-label*='rompt'], div[role=\"textbox\"], flow-rich-text-editor, textarea[aria-label*='rompt']",
  promptChipInEditor: "[contenteditable=\"false\"], mat-chip, flow-mention-chip, flow-inline-chip, [data-mention], [data-type=\"mention\"], [class*=\"mention\"], [class*=\"chip\"], [class*=\"ingredient\"] img",
  promptBoxContainer: "flow-base-prompt-box, flow-prompt-box, flow-agent-panel, [class*='prompt-box'], form",
  ingredientArea: "flow-ingredient-bar, flow-base-prompt-box, flow-prompt-box, [class*='ingredient'], [class*='prompt-box']",
  submitButton: "div.submit-controls button:has(mat-icon:contains(\"arrow_forward\")), flow-generate-icon-button button, button[aria-label*='Generate'], button[aria-label*='Create'], button[aria-label*='Send'], div.submit-controls button:has(mat-icon:contains(\"arrow_upward\")), div.submit-controls button:has(mat-icon:contains(\"send\"))",
  stopButton: "button:has(i:contains(\"stop_circle_should_not_have\"))",

  /* ---------- add / upload / mention popover ---------- */
  uploadMediaButton: "button:has(mat-icon:contains(\"upload\")):last(), button:has(span:contains(\"upload\")):last(), button[aria-label*='Upload']:last()",
  selectUploadImageType: "flow-add-menu-popover-content mat-list-item:has(mat-icon:contains(\"drive_folder_upload\")), flow-add-menu-popover-content mat-list-item mat-icon:contains(\"drive_folder_upload\")",
  selectUploadVideoType: "flow-add-menu-popover-content mat-list-item:has(mat-icon:contains(\"drive_folder_upload\")), flow-add-menu-popover-content mat-list-item mat-icon:contains(\"drive_folder_upload\")",
  agreeTermUploadedVideoButton: "div.agree-actions-group button:eq(-1)",
  selectUploadCharacterType: "flow-add-menu-popover-content mat-list-item:has(mat-icon:contains(\"accessibility_new\")), flow-add-menu-popover-content [role='tab']:contains('Character'), flow-add-menu-popover-content button:contains('Character'), flow-add-menu-popover-content mat-list-item:contains('Character')",
  selectSpeakerType: "flow-add-menu-popover-content mat-list-item:has(mat-icon:contains(\"voice_selection\")), flow-add-menu-popover-content mat-list-item:has(mat-icon:contains(\"record_voice_over\")), flow-add-menu-popover-content [role='tab']:contains('Voice'), flow-add-menu-popover-content button:contains('Voice'), flow-add-menu-popover-content mat-list-item:contains('Voice')",
  mentionPopover: "flow-add-menu-popover-content, flow-mention-menu, flow-mention-popover, [class*='mention-menu'], [class*='mention-popover'], [class*='typeahead'], [role='listbox'], .cdk-overlay-pane, div[popover]",
  sortOptionsButton: "flow-add-menu-popover-content header mat-select:last()",
  sortLatestOption: "div[popover=\"manual\"] mat-option:eq(0)",
  virtuosoItemList: "flow-add-menu-popover-content flow-add-menu-asset-list div.cdk-virtual-scroll-content-wrapper > div",
  firstFoundedItemSelector: "flow-add-menu-popover-content flow-add-menu-asset-list div.cdk-virtual-scroll-content-wrapper > div:has(img):first(), flow-add-menu-popover-content [role='option']:has(img):first(), flow-add-menu-popover-content mat-list-item:has(img):first()",
  uploadsTabInAddMenu: "flow-add-menu-popover-content [role='tab']:contains('Upload'), flow-add-menu-popover-content [role='tab']:contains('Image'), flow-add-menu-popover-content [role='tab']:contains('Media'), flow-add-menu-popover-content mat-list-item:has(mat-icon:contains(\"drive_folder_upload\")), flow-add-menu-popover-content button:has(mat-icon:contains(\"drive_folder_upload\")), flow-add-menu-popover-content [role='tab']:has(mat-icon:contains(\"photo_library\")), flow-add-menu-popover-content [role='tab']:has(mat-icon:contains(\"image\"))",
  uploadedAssetItem: "flow-add-menu-asset-list div.cdk-virtual-scroll-content-wrapper > div, flow-add-menu-popover-content [role='option'], flow-add-menu-popover-content mat-list-item, flow-add-menu-popover-content [role='gridcell']",
  searchUploadedImage: "flow-add-menu-popover-content input.search-input, flow-add-menu-popover-content input[type='search'], flow-add-menu-popover-content input[type='text'], .cdk-overlay-pane input[placeholder*='earch']",

  /* ---------- grid / tiles ---------- */
  outputItems: "cdk-virtual-scroll-viewport div.virtual-item-container flow-grid-tile-container",
  tileOnQueue: "flow-pending-tile",
  tileByIndexTemplate: "cdk-virtual-scroll-viewport div.virtual-item-container flow-grid-tile-container:eq({index})",
  tileEditLink: "a[href*=\"/edit/\"], a[href*=\"edit\"], button[aria-label*='Edit'], button:has(mat-icon:contains(\"edit\")), button:has(span:contains(\"edit\"))",
  tileAddToPromptButton: "button[aria-label*='Add to prompt'], button[aria-label*='add to prompt'], button[aria-label*='Use in prompt'], button[aria-label*='Reuse'], button:contains('Add to prompt'), button:has(mat-icon:contains(\"add_photo_alternate\"))",
  moreOptionsButtonInHoverTile: "button:has(mat-icon:contains(\"more_vert\")), button:has(span:contains(\"more_vert\")), button[aria-label*='More']",
  downloadButtonInHoverTile: "flow-menu-item mat-icon:contains(\"download\"), [role='menuitem']:has(mat-icon:contains(\"download\")), [role='menuitem']:contains('Download')",
  quality1080Option: "button:has(span:contains(\"1080p\")), [role='menuitem']:contains('1080p')",
  quality2KOption: "button:has(span:contains(\"2K\")), [role='menuitem']:contains('2K')",
  quality4KOption: "button:has(span:contains(\"4K\")), [role='menuitem']:contains('4K')",
  downloadDoneButton: "div.editor-buttons-group button:last()"
};
