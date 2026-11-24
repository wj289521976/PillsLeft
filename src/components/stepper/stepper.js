// 通用步进器组件（R11 适老：−/+ 大按钮为主、点数字键入为辅）。
// 用法：<stepper value="{{n}}" min="1" max="99" step="1" bind:change="onChange" />
// change 事件：e.detail.value 为规整后的数值（0.5 步进的浮点误差已消除）。
Component({
  properties: {
    value: {
      type: Number,
      value: 0,
      observer(nv) {
        // 外部回写同步显示（本地键入中间态不打断）
        if (this.fmt(nv) !== this.data.display) this.setData({ display: this.fmt(nv) });
      }
    },
    min: { type: Number, value: 0 },
    max: { type: Number, value: 99 },
    step: { type: Number, value: 1 }
  },

  data: { display: '0' },

  lifetimes: {
    attached() {
      this.setData({ display: this.fmt(this.data.value) });
    }
  },

  methods: {
    fmt(v) {
      return String(Math.round(v * 10000) / 10000); // 消除 0.5 步进浮点误差、去尾零
    },
    emit(v) {
      const clamped = Math.min(this.properties.max, Math.max(this.properties.min, Math.round(v * 10000) / 10000));
      this.setData({ display: this.fmt(clamped) });
      this.triggerEvent('change', { value: clamped });
    },
    onMinus() {
      this.emit(Number(this.data.display) - this.properties.step);
    },
    onPlus() {
      this.emit(Number(this.data.display) + this.properties.step);
    },
    onInput(e) {
      // 键入为辅：原样显示中间态，能解析且不低于 min 即透传（不 clamp，避免打字被打断）。
      // 审核修复 A11：原 n>0 把 0 排除在透传外——min=0 的场景（校准页"还剩几粒"）键入 0
      // 须等失焦才同步；min>0 的场景（剂量 0.5 起）键入低于 min 的值同样留待失焦收口。
      this.setData({ display: e.detail.value });
      const n = parseFloat(e.detail.value);
      if (!isNaN(n) && n >= this.properties.min) {
        this.triggerEvent('change', { value: Math.round(n * 10000) / 10000 });
      }
    },
    onBlur() {
      const n = parseFloat(this.data.display);
      this.emit(isNaN(n) ? this.properties.min : n); // 失焦才收口：clamp + 规整
    }
  }
});
