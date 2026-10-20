(() => {
  const NAMEPLATE_STYLE = Object.freeze({
    fontWeight: 900,
    renderScale: 1.425,
    strokeWidth: 3.3,
    mainStrokeWidth: 1,
    depth: 8,
    depthLayers: 4,
    depthOpacity: 0.82,
    depthStrokeWidth: 1.2,
    letterSpacing: -1,
    highlightOffset: -1,
    highlightStrokeWidth: 1.75,
    highlightOpacity: 0.48,
    minimumFontScale: 0.35,
    minimumFontSize: 12,
  });

  class PersonalizerConfig {
    static supportedTypes = new Set(['name', 'initials', 'engraving', 'date', 'coordinates', 'double_name']);

    static supportedRules = new Set([
      'letters_only',
      'letters_spaces',
      'letters_and_spaces',
      'letters_spaces_hyphens_apostrophes',
      'letters_spaces_hyphens_and_apostrophes',
    ]);

    constructor(root) {
      const requestedType = (root.dataset.personalizerType || 'name').trim().toLowerCase();
      this.type = PersonalizerConfig.supportedTypes.has(requestedType) ? requestedType : 'name';
      this.maximumCharacters = Math.floor(this.number(root.dataset.maximumCharacters, 12, 1, 100));
      this.minimumCharacters = Math.ceil(
        this.number(root.dataset.minimumCharacters, 1, 1, this.maximumCharacters)
      );
      this.previewX = this.number(root.dataset.previewX, 50, 0, 100);
      this.previewY = this.number(root.dataset.previewY, 50, 0, 100);
      this.previewFontSize = this.number(root.dataset.previewFontSize, 64, 8, 200);
      this.previewRotation = this.number(root.dataset.previewRotation, 0, -180, 180);
      this.previewMaxWidth = this.number(root.dataset.previewMaxWidth, 450, 50, 1000);
      this.defaultPreviewText = root.dataset.defaultPreviewText?.trim() || 'Your Name';
      this.allowedCharacters = this.characterRule(root.dataset.allowedCharacters);
      this.fonts = (root.dataset.fonts || 'Classic')
        .split('|')
        .map((font) => font.trim())
        .filter(Boolean);
      this.helpText = root.dataset.helpText || '';
      this.materialOptionName = root.dataset.materialOptionName?.trim() || '';
      this.materialOptionPosition = Math.floor(this.number(root.dataset.materialOptionPosition, 0, 0, 3));
    }

    number(value, fallback, minimum, maximum) {
      const parsed = Number.parseFloat(value);
      const safeValue = Number.isFinite(parsed) ? parsed : fallback;
      return Math.min(maximum, Math.max(minimum, safeValue));
    }

    characterRule(value) {
      const normalized = (value || 'letters_spaces_hyphens_apostrophes')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      return PersonalizerConfig.supportedRules.has(normalized)
        ? normalized
        : 'letters_spaces_hyphens_apostrophes';
    }
  }

  class FontManager {
    static fontStacks = Object.freeze({
      Signature: `'Segoe Script', 'Brush Script MT', cursive`,
      Classic: `Georgia, 'Times New Roman', serif`,
      Modern: 'Arial, Helvetica, sans-serif',
      Elegant: `'Times New Roman', Georgia, serif`,
    });

    constructor(select, configuredFonts) {
      this.select = select;
      this.availableFonts = configuredFonts.filter((label) => FontManager.fontStacks[label]);
      if (this.availableFonts.length === 0) this.availableFonts = ['Classic'];
    }

    initialize() {
      const existingOptions = new Map(Array.from(this.select.options).map((option) => [option.value, option]));

      Array.from(this.select.options).forEach((option) => {
        if (!this.availableFonts.includes(option.value) || !FontManager.fontStacks[option.value]) option.remove();
      });

      this.availableFonts.forEach((label) => {
        let option = existingOptions.get(label);
        if (!option || !option.isConnected) {
          option = document.createElement('option');
          option.value = label;
          option.textContent = label;
          this.select.append(option);
        }
        option.style.fontFamily = FontManager.fontStacks[label];
      });

      if (!this.availableFonts.includes(this.select.value)) this.select.value = this.availableFonts[0];
      this.updateSelectStyle();
    }

    updateSelectStyle() {
      this.select.style.fontFamily = this.fontStack;
    }

    get label() {
      return this.availableFonts.includes(this.select.value) ? this.select.value : this.availableFonts[0];
    }

    get fontStack() {
      return FontManager.fontStacks[this.label] || FontManager.fontStacks.Classic;
    }
  }

  class PreviewManager {
    static materialStyles = Object.freeze({
      gold: { outline: '#A77A27', depth: '#8F6A26', highlight: '#FFF6D6' },
      silver: { outline: '#87939D', depth: '#6F7C87', highlight: '#FFFFFF' },
      'rose-gold': { outline: '#A96F62', depth: '#956257', highlight: '#FFE2D8' },
      neutral: {
        fill: 'rgba(82, 74, 64, 0.94)',
        outline: '#5f574e',
        depth: '#403b36',
        highlight: '#ffffff',
      },
    });

    constructor(media, template, config, fontManager, instanceId) {
      this.media = media;
      this.template = template;
      this.config = config;
      this.fontManager = fontManager;
      this.instanceId = instanceId;
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d');
      this.pendingText = '';
    }

    initialize() {
      if (!this.media || !this.template?.content) return;
      this.destroyed = false;

      const existingPreview = Array.from(this.media.children).find(
        (child) => child.dataset?.personalizerOwner === this.instanceId
      );
      existingPreview?.remove();

      const fragment = this.template.content.cloneNode(true);
      this.svg = fragment.querySelector('[data-jewelry-preview-svg]');
      this.previewGroup = fragment.querySelector('[data-jewelry-preview-group]');
      this.previewText = fragment.querySelector('[data-jewelry-preview-text]');
      this.outlineText = fragment.querySelector('[data-jewelry-preview-outline]');
      this.highlightText = fragment.querySelector('[data-jewelry-preview-highlight]');
      this.depthTexts = Array.from(fragment.querySelectorAll('[data-jewelry-depth-layer]'));
      if (
        !this.svg ||
        !this.previewGroup ||
        !this.previewText ||
        !this.outlineText ||
        !this.highlightText ||
        this.depthTexts.length !== NAMEPLATE_STYLE.depthLayers
      ) {
        return;
      }
      this.textLayers = [...this.depthTexts, this.outlineText, this.previewText, this.highlightText];
      this.materialGradients = new Map(
        Array.from(fragment.querySelectorAll('[data-jewelry-material-gradient]')).map((gradient) => [
          gradient.dataset.jewelryMaterialGradient,
          gradient,
        ])
      );

      this.media.classList.add('jewelry-personalizer__media');
      this.svg.dataset.personalizerOwner = this.instanceId;
      this.media.append(fragment);
      this.setMaterial('neutral');

      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
        this.resizeObserver.observe(this.media);
      } else {
        this.onResize = this.scheduleRender.bind(this);
        window.addEventListener('resize', this.onResize);
      }

      document.fonts?.ready.then(() => {
        if (!this.destroyed) this.scheduleRender();
      });
    }

    update(value) {
      this.pendingText = value.trim() || this.config.defaultPreviewText;
      this.scheduleRender();
    }

    setMaterial(category) {
      if (!this.svg || !this.previewText || !this.outlineText || !this.highlightText) return;

      const safeCategory = ['gold', 'silver', 'rose-gold'].includes(category) ? category : 'neutral';
      const gradient = this.materialGradients?.get(safeCategory);
      const materialStyle = PreviewManager.materialStyles[safeCategory];
      this.svg.dataset.materialCategory = safeCategory;

      if (gradient?.id) {
        this.previewText.setAttribute('fill', `url(#${gradient.id})`);
      } else {
        this.previewText.setAttribute('fill', PreviewManager.materialStyles.neutral.fill);
      }
      this.previewText.setAttribute('stroke', materialStyle.outline);
      this.previewText.setAttribute('stroke-width', String(NAMEPLATE_STYLE.mainStrokeWidth));
      this.previewText.setAttribute('stroke-linejoin', 'round');

      this.outlineText.setAttribute('fill', 'none');
      this.outlineText.setAttribute('stroke', materialStyle.outline);
      this.outlineText.setAttribute('stroke-width', String(NAMEPLATE_STYLE.strokeWidth));
      this.outlineText.setAttribute('stroke-linejoin', 'round');

      this.depthTexts.forEach((depthText) => {
        depthText.setAttribute('fill', materialStyle.depth);
        depthText.setAttribute('stroke', materialStyle.depth);
        depthText.setAttribute('stroke-width', String(NAMEPLATE_STYLE.depthStrokeWidth));
        depthText.setAttribute('stroke-linejoin', 'round');
        depthText.setAttribute('opacity', String(NAMEPLATE_STYLE.depthOpacity));
      });

      this.highlightText.setAttribute('fill', 'none');
      this.highlightText.setAttribute('stroke', materialStyle.highlight);
      this.highlightText.setAttribute('stroke-width', String(NAMEPLATE_STYLE.highlightStrokeWidth));
      this.highlightText.setAttribute('stroke-linecap', 'round');
      this.highlightText.setAttribute('stroke-linejoin', 'round');
      this.highlightText.setAttribute('opacity', String(NAMEPLATE_STYLE.highlightOpacity));
      this.scheduleRender();
    }

    scheduleRender() {
      if (!this.svg || !this.previewText || this.animationFrame) return;
      this.animationFrame = window.requestAnimationFrame(() => {
        this.animationFrame = null;
        this.render();
      });
    }

    render() {
      if (!this.svg || !this.previewGroup || !this.previewText || !this.textLayers?.length) return;

      const fontStack = this.fontManager.fontStack;
      const configuredSize = this.config.previewFontSize * NAMEPLATE_STYLE.renderScale;
      const minimumSize = Math.min(
        configuredSize,
        Math.max(NAMEPLATE_STYLE.minimumFontSize, configuredSize * NAMEPLATE_STYLE.minimumFontScale)
      );
      const visibleLayerAllowance =
        NAMEPLATE_STYLE.depth +
        NAMEPLATE_STYLE.strokeWidth +
        Math.abs(NAMEPLATE_STYLE.highlightOffset) * 2;
      const availableTextWidth = Math.max(1, this.config.previewMaxWidth - visibleLayerAllowance);
      const x = this.config.previewX * 10;
      const y = this.config.previewY * 10;
      let renderedSize = configuredSize;

      this.applySharedLayerAttributes(configuredSize, x, y, fontStack);
      this.previewGroup.setAttribute('transform', `rotate(${this.config.previewRotation} ${x} ${y})`);

      const measuredWidth = this.measureText(configuredSize, fontStack);
      if (measuredWidth > availableTextWidth && measuredWidth > 0) {
        renderedSize = Math.max(
          minimumSize,
          configuredSize * (availableTextWidth / measuredWidth)
        );
      }

      this.applySharedLayerAttributes(renderedSize, x, y, fontStack);
    }

    applySharedLayerAttributes(fontSize, x, y, fontStack) {
      this.textLayers.forEach((layer) => {
        layer.textContent = this.pendingText;
        layer.dataset.font = this.fontManager.label;
        layer.style.fontFamily = fontStack;
        layer.setAttribute('x', String(x));
        layer.setAttribute('y', String(y));
        layer.setAttribute('font-size', String(fontSize));
        layer.setAttribute('font-weight', String(NAMEPLATE_STYLE.fontWeight));
        layer.setAttribute('letter-spacing', String(NAMEPLATE_STYLE.letterSpacing));
      });

      const depthStep = NAMEPLATE_STYLE.depth / NAMEPLATE_STYLE.depthLayers;
      this.depthTexts.forEach((layer, index) => {
        const offset = depthStep * (index + 1);
        layer.setAttribute('transform', `translate(${offset} ${offset})`);
      });
      this.outlineText.removeAttribute('transform');
      this.previewText.removeAttribute('transform');
      this.highlightText.setAttribute(
        'transform',
        `translate(${NAMEPLATE_STYLE.highlightOffset} ${NAMEPLATE_STYLE.highlightOffset})`
      );
    }

    measureText(fontSize, fontStack) {
      if (
        this.previewText.isConnected &&
        this.svg.getClientRects().length > 0 &&
        typeof this.previewText.getComputedTextLength === 'function'
      ) {
        try {
          const svgWidth = this.previewText.getComputedTextLength();
          if (Number.isFinite(svgWidth) && svgWidth > 0) return svgWidth;
        } catch {
          // Some browsers cannot measure SVG text while its section is being replaced.
        }
      }

      if (!this.context || !this.pendingText) return 0;
      this.context.font = `${NAMEPLATE_STYLE.fontWeight} ${fontSize}px ${fontStack}`;
      const measuredWidth = this.context.measureText(this.pendingText).width;
      const letterSpacingWidth =
        Math.max(0, Array.from(this.pendingText).length - 1) * NAMEPLATE_STYLE.letterSpacing;
      return Math.max(0, measuredWidth + letterSpacingWidth);
    }

    destroy() {
      this.destroyed = true;
      if (this.animationFrame) window.cancelAnimationFrame(this.animationFrame);
      this.resizeObserver?.disconnect();
      if (this.onResize) window.removeEventListener('resize', this.onResize);
      this.svg?.remove();

      if (!this.media?.querySelector('.jewelry-personalizer__preview-svg')) {
        this.media?.classList.remove('jewelry-personalizer__media');
      }
    }
  }

  class MaterialManager {
    static materialCategories = Object.freeze({
      gold: 'gold',
      'yellow gold': 'gold',
      'gold plated': 'gold',
      '14k gold': 'gold',
      '18k gold': 'gold',
      silver: 'silver',
      'sterling silver': 'silver',
      '925 silver': 'silver',
      'white silver': 'silver',
      'rose gold': 'rose-gold',
      'rose-gold': 'rose-gold',
      rosegold: 'rose-gold',
      'rose gold plated': 'rose-gold',
    });

    constructor(root, scope, config, previewManager) {
      this.root = root;
      this.scope = scope;
      this.config = config;
      this.previewManager = previewManager;
      this.fieldset = root.querySelector('[data-jewelry-materials]');
      this.propertyInput = root.querySelector('[data-jewelry-material-property]');
      this.controls = Array.from(root.querySelectorAll('.jewelry-personalizer__material-input'));
      this.warned = new Set();
    }

    initialize() {
      if (!this.scope || !this.fieldset || this.controls.length === 0 || !this.config.materialOptionName) {
        this.hide();
        return false;
      }

      this.onCustomChange = this.handleCustomChange.bind(this);
      this.onScopeChange = this.handleScopeChange.bind(this);
      this.fieldset.addEventListener('change', this.onCustomChange);
      this.scope.addEventListener('change', this.onScopeChange);

      if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
        this.variantChangeUnsubscriber = subscribe(
          PUB_SUB_EVENTS.variantChange,
          this.handleVariantChange.bind(this)
        );
      }

      if ('MutationObserver' in window) {
        this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
        this.observer.observe(this.scope, { childList: true, subtree: true });
      }

      this.syncFromDawn();
      return true;
    }

    destroy() {
      this.fieldset?.removeEventListener('change', this.onCustomChange);
      this.scope?.removeEventListener('change', this.onScopeChange);
      this.variantChangeUnsubscriber?.();
      this.observer?.disconnect();
      if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame);
      this.clearNativeSourceClasses();
    }

    normalizeOptionName(value) {
      return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    normalizeMaterial(value) {
      const normalized = this.normalizeOptionName(value);
      return MaterialManager.materialCategories[normalized] || 'neutral';
    }

    get variantSelects() {
      return this.scope?.querySelector('variant-selects') || null;
    }

    getNativeEntries() {
      const expectedName = this.normalizeOptionName(this.config.materialOptionName);
      if (!expectedName || !this.variantSelects) return [];

      return Array.from(this.variantSelects.querySelectorAll('[data-option-name]')).filter(
        (entry) => this.normalizeOptionName(entry.dataset.optionName) === expectedName
      );
    }

    markNativeSource(entries) {
      this.clearNativeSourceClasses();
      this.nativeSourceWrappers = new Set(
        entries
          .map((entry) => entry.closest('fieldset, .product-form__input--dropdown'))
          .filter(Boolean)
      );
      this.nativeSourceWrappers.forEach((wrapper) =>
        wrapper.classList.add('jewelry-personalizer-native-material-source')
      );
    }

    clearNativeSourceClasses() {
      this.nativeSourceWrappers?.forEach((wrapper) =>
        wrapper.classList.remove('jewelry-personalizer-native-material-source')
      );
      this.nativeSourceWrappers = new Set();
    }

    warnOnce(key, message) {
      if (this.warned.has(key)) return;
      this.warned.add(key);
      console.warn(`[Jewelry personalizer] ${message}`);
    }

    getSelectedValue(entries = this.getNativeEntries()) {
      const selectedEntry = entries.find((entry) => {
        if (entry.tagName === 'INPUT') return entry.checked;
        if (entry.tagName === 'OPTION') return entry.selected || entry.hasAttribute('selected');
        return false;
      });
      return selectedEntry?.value || '';
    }

    findNativeEntry(value, entries = this.getNativeEntries()) {
      return entries.find((entry) => entry.value === value) || null;
    }

    isEntryAvailable(entry) {
      return Boolean(entry) && entry.dataset.optionAvailable !== 'false';
    }

    syncFromDawn() {
      const entries = this.getNativeEntries();
      if (entries.length === 0) {
        this.clearNativeSourceClasses();
        this.warnOnce(
          'missing-native-material',
          `No native Dawn option inputs matched material option '${this.config.materialOptionName}'.`
        );
        this.hide();
        return '';
      }

      this.markNativeSource(entries);
      const selectedValue = this.getSelectedValue(entries);
      this.fieldset.hidden = false;

      this.controls.forEach((control) => {
        const nativeEntry = this.findNativeEntry(control.value, entries);
        const available = this.isEntryAvailable(nativeEntry);
        control.disabled = !available;
        control.checked = control.value === selectedValue;
        control.dataset.materialState = nativeEntry ? (available ? 'available' : 'unavailable') : 'nonexistent';
      });

      if (this.propertyInput) {
        this.propertyInput.value = selectedValue;
        this.propertyInput.disabled = !selectedValue;
      }

      this.previewManager.setMaterial(this.normalizeMaterial(selectedValue));
      this.warnIfVariantHasNoMedia(this.getSelectedVariantData());
      return selectedValue;
    }

    getSelectedVariantData() {
      const script = this.variantSelects?.querySelector?.('[data-selected-variant]');
      if (!script?.textContent) return null;

      try {
        return JSON.parse(script.textContent);
      } catch {
        return null;
      }
    }

    warnIfVariantHasNoMedia(variant) {
      if (!variant || variant.featured_media) return;
      this.warnOnce(
        `variant-without-media-${variant.id || 'unknown'}`,
        `Selected variant ${variant.id || ''} has no featured media assigned.`.trim()
      );
    }

    hide() {
      if (this.fieldset) this.fieldset.hidden = true;
      if (this.propertyInput) {
        this.propertyInput.value = '';
        this.propertyInput.disabled = true;
      }
      this.previewManager?.setMaterial('neutral');
    }

    handleCustomChange(event) {
      if (!(event.target instanceof Element) || !event.target.matches('.jewelry-personalizer__material-input')) {
        return;
      }
      if (event.target.disabled || this.syncingToDawn) return;
      this.selectDawnValue(event.target.value);
    }

    selectDawnValue(value) {
      const entries = this.getNativeEntries();
      const nativeEntry = this.findNativeEntry(value, entries);
      if (!nativeEntry) {
        this.warnOnce(
          `missing-material-value-${value}`,
          `Material value '${value}' does not exactly match a native Shopify option value.`
        );
        this.syncFromDawn();
        return false;
      }
      if (!this.isEntryAvailable(nativeEntry)) {
        this.syncFromDawn();
        return false;
      }

      const nativeControl = nativeEntry.tagName === 'OPTION' ? nativeEntry.closest('select') : nativeEntry;
      if (!nativeControl) return false;

      this.syncingToDawn = true;
      if (nativeEntry.tagName === 'OPTION') {
        nativeControl.value = nativeEntry.value;
      } else {
        nativeControl.checked = true;
      }
      nativeControl.dispatchEvent(new Event('change', { bubbles: true }));
      this.syncingToDawn = false;
      this.syncFromDawn();
      return true;
    }

    handleScopeChange(event) {
      if (!(event.target instanceof Element) || !this.variantSelects?.contains(event.target)) return;
      this.queueSync();
    }

    handleVariantChange({ data }) {
      if (!data || String(data.sectionId) !== String(this.scope.dataset.section)) return;
      this.warnIfVariantHasNoMedia(data.variant);
      this.queueSync();
    }

    handleMutations(mutations) {
      const pickerChanged = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (target?.closest('variant-selects')) return true;

        return [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches('variant-selects') || Boolean(node.querySelector('variant-selects')))
        );
      });

      if (pickerChanged) this.queueSync();
    }

    queueSync() {
      if (this.syncFrame) return;
      this.syncFrame = window.requestAnimationFrame(() => {
        this.syncFrame = null;
        this.syncFromDawn();
      });
    }
  }

  class ValidationManager {
    static patterns = Object.freeze({
      letters_only: /^[\p{L}\p{M}]+$/u,
      letters_spaces: /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u,
      letters_and_spaces: /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u,
      letters_spaces_hyphens_apostrophes:
        /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u,
      letters_spaces_hyphens_and_apostrophes:
        /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u,
    });

    constructor(input, errorMessage, config, onNormalized) {
      this.input = input;
      this.errorMessage = errorMessage;
      this.config = config;
      this.onNormalized = onNormalized;
      this.validateOnInput = false;
    }

    handleInput() {
      if (this.validateOnInput) {
        this.validate(false);
      } else {
        this.clearError();
      }
    }

    validate(normalizeValue = false) {
      if (normalizeValue) this.normalize();

      const value = this.input.value.trim();
      const characterCount = Array.from(value).length;
      let message = '';

      if (!value) {
        message = 'Please enter a name before adding this item to your cart.';
      } else if (!normalizeValue && /\s{2,}/u.test(this.input.value)) {
        message = 'Please use only one space between words.';
      } else if (characterCount < this.config.minimumCharacters) {
        message = `Please enter at least ${this.config.minimumCharacters} characters.`;
      } else if (characterCount > this.config.maximumCharacters) {
        message = `Please enter no more than ${this.config.maximumCharacters} characters.`;
      } else if (!this.pattern.test(value)) {
        message = this.allowedCharactersMessage;
      }

      if (!message) {
        this.clearError();
        return true;
      }

      this.validateOnInput = true;
      this.input.setCustomValidity(message);
      this.input.setAttribute('aria-invalid', 'true');
      this.errorMessage.textContent = message;
      this.errorMessage.hidden = false;
      return false;
    }

    normalize() {
      const normalized = this.input.value.trim().replace(/\s+/gu, ' ');
      if (normalized === this.input.value) return;

      this.input.value = normalized;
      this.onNormalized?.();
    }

    clearError() {
      this.input.setCustomValidity('');
      this.input.removeAttribute('aria-invalid');
      this.errorMessage.hidden = true;
    }

    focus() {
      this.input.focus();
    }

    get pattern() {
      return (
        ValidationManager.patterns[this.config.allowedCharacters] ||
        ValidationManager.patterns.letters_spaces_hyphens_apostrophes
      );
    }

    get allowedCharactersMessage() {
      if (this.config.allowedCharacters === 'letters_only') {
        return 'Please use letters only.';
      }
      if (
        this.config.allowedCharacters === 'letters_spaces' ||
        this.config.allowedCharacters === 'letters_and_spaces'
      ) {
        return 'Please use letters and single spaces only.';
      }
      return `Please use letters, single spaces, hyphens, and apostrophes only.`;
    }
  }

  if (!customElements.get('jewelry-personalizer')) {
    customElements.define(
      'jewelry-personalizer',
      class JewelryPersonalizer extends HTMLElement {
        connectedCallback() {
          if (this.initialized) return;

          try {
            this.initialized = this.initialize();
          } catch (error) {
            this.initialized = false;
            console.warn('A jewelry personalizer instance could not be initialized.', error);
          }
        }

        initialize() {
          this.form = this.closest('form') || document.getElementById(this.dataset.formId);
          this.nameInput = this.querySelector(`[name='properties[Personalized Name]']`);
          this.fontSelect = this.querySelector(`[name='properties[Font]']`);
          this.counter = this.querySelector('[data-character-count]');
          this.errorMessage = this.querySelector('.jewelry-personalizer__error');

          if (!this.form || !this.nameInput || !this.fontSelect || !this.counter || !this.errorMessage) {
            return false;
          }

          this.config = new PersonalizerConfig(this);
          this.dataset.configuredType = this.config.type;
          this.dataset.activeType = 'name';
          this.nameInput.minLength = Math.ceil(this.config.minimumCharacters);
          this.nameInput.maxLength = Math.floor(this.config.maximumCharacters);

          this.fontManager = new FontManager(this.fontSelect, this.config.fonts);
          this.fontManager.initialize();
          this.productScope = this.findProductScope();

          this.previewManager = new PreviewManager(
            this.findPreviewMedia(),
            this.querySelector('[data-jewelry-preview-template]'),
            this.config,
            this.fontManager,
            this.dataset.instanceId
          );
          this.previewManager.initialize();

          this.materialManager = new MaterialManager(
            this,
            this.productScope,
            this.config,
            this.previewManager
          );
          this.materialManager.initialize();

          this.validationManager = new ValidationManager(
            this.nameInput,
            this.errorMessage,
            this.config,
            this.updateOutput.bind(this)
          );

          this.onInput = this.handleInput.bind(this);
          this.onFontChange = this.handleFontChange.bind(this);
          this.onSubmit = this.handleSubmit.bind(this);
          this.onFormClick = this.handleFormClick.bind(this);

          this.nameInput.addEventListener('input', this.onInput);
          this.fontSelect.addEventListener('change', this.onFontChange);
          this.form.addEventListener('submit', this.onSubmit, true);
          this.form.addEventListener('click', this.onFormClick, true);

          this.updateOutput();
          return true;
        }

        disconnectedCallback() {
          if (!this.initialized) return;

          this.nameInput?.removeEventListener('input', this.onInput);
          this.fontSelect?.removeEventListener('change', this.onFontChange);
          this.form?.removeEventListener('submit', this.onSubmit, true);
          this.form?.removeEventListener('click', this.onFormClick, true);
          this.materialManager?.destroy();
          this.previewManager?.destroy();
          this.initialized = false;
        }

        findProductScope() {
          return (
            this.closest('product-info') ||
            this.closest('.featured-product') ||
            this.closest('quick-add-modal') ||
            this.closest('.shopify-section')
          );
        }

        findPreviewMedia() {
          const scope = this.productScope || this.findProductScope();
          if (!scope) return null;

          return (
            scope.querySelector('media-gallery .product__media-item.is-active .product__media') ||
            scope.querySelector('media-gallery .product__media-item .product__media')
          );
        }

        handleInput() {
          this.validationManager.handleInput();
          this.updateOutput();
        }

        handleFontChange() {
          this.fontManager.updateSelectStyle();
          this.previewManager.update(this.nameInput.value);
        }

        updateOutput() {
          this.counter.textContent = Array.from(this.nameInput.value).length;
          this.previewManager.update(this.nameInput.value);
        }

        handleSubmit(event) {
          this.validatePurchase(event);
        }

        handleFormClick(event) {
          if (!(event.target instanceof Element)) return;

          const submitControl = event.target.closest(`[type='submit'], .shopify-payment-button`);
          if (!submitControl) return;
          this.validatePurchase(event);
        }

        validatePurchase(event) {
          this.materialManager?.syncFromDawn();
          if (this.validationManager.validate(true)) {
            this.updateOutput();
            return;
          }

          event.preventDefault();
          event.stopImmediatePropagation();
          this.validationManager.focus();
        }
      }
    );
  }
})();
