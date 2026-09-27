import { Blockly } from "@bark/scripting/blocks";

class Constants extends Blockly.zelos.ConstantProvider {
  constructor() {
    super();
    this.ADD_START_HATS = true;
    this.CORNER_RADIUS = 9;
    this.START_HAT_HEIGHT = 18;
    this.FIELD_BORDER_RECT_RADIUS = 15;
    this.MIN_BLOCK_HEIGHT = 48;
  }
}

// Events retain their DO input in saved files and in the compiler. The renderer
// presents that connection at the bottom of a hat, like a Scratch event.
class Drawer extends Blockly.zelos.Drawer {
  private hatSize?: { width: number; height: number };
  private compactHat = false;

  drawOutline_() {
    const block = this.block_;
    const statement = this.info_.rows.find((row) => row.hasStatement);
    if (
      block.isInFlyout &&
      block.previousConnection &&
      statement &&
      !statement.getLastInput()?.connectionModel?.targetBlock()
    ) {
      super.drawOutline_();
      const width = this.info_.width;
      const height = statement.yPos;
      const notch = this.info_.bottomRow.notchOffset;
      const shape = this.constants_.NOTCH;
      this.outlinePath_ = "";
      this.drawTop_();
      this.outlinePath_ += `V ${height - 9} Q ${width} ${height} ${width - 9} ${height} H ${notch + shape.width} ${shape.pathRight} H 9 Q 0 ${height} 0 ${height - 9} V 9 Z`;
      this.hatSize = { width, height };
      for (const input of block.inputList) {
        if (input.type !== Blockly.inputs.inputTypes.STATEMENT) continue;
        for (const field of input.fieldRow)
          field.getSvgRoot()?.setAttribute("visibility", "hidden");
      }
      return;
    }
    if (
      block.previousConnection ||
      block.outputConnection ||
      !block.getInput("DO") ||
      !statement
    ) {
      super.drawOutline_();
      return;
    }
    const input = statement.getLastInput()!;
    const fields = block.inputList
      .filter((item) => item.name !== "DO")
      .flatMap((item) => item.fieldRow);
    const width = Math.max(
      240,
      fields.reduce((sum, field) => sum + field.getSize().width + 10, 24),
    );
    const height = statement.yPos - (block.isInFlyout ? 14 : 0);
    const notch = input.notchOffset;
    const shape = this.constants_.NOTCH;
    this.compactHat = block.isInFlyout;
    const top = block.isInFlyout
      ? `M 0 10 Q 0 0 10 0 H ${width - 10} Q ${width} 0 ${width} 10`
      : `M 0 18 C 28 -6 72 -6 112 18 H ${width - 12} Q ${width} 18 ${width} 30`;
    this.outlinePath_ = `${top} V ${height - 10} Q ${width} ${height} ${width - 10} ${height} H ${notch + shape.width} ${shape.pathRight} H 10 Q 0 ${height} 0 ${height - 10} Z`;
    input.connectionModel!.setOffsetInBlock(notch, height);
    this.hatSize = { width, height };
  }

  protected drawInternals_() {
    super.drawInternals_();
    if (!this.compactHat) return;
    for (const field of this.block_.inputList[0].fieldRow) {
      const root = field.getSvgRoot();
      if (root)
        root.setAttribute(
          "transform",
          `${root.getAttribute("transform")} translate(0,-14)`,
        );
    }
  }

  protected recordSizeOnBlock_() {
    super.recordSizeOnBlock_();
    if (!this.hatSize) return;
    const child = this.block_.getInputTargetBlock(
      "DO",
    ) as Blockly.BlockSvg | null;
    const bounds = child?.getHeightWidth();
    this.block_.height = this.hatSize.height + (bounds?.height ?? 8);
    this.block_.width = Math.max(this.hatSize.width, bounds?.width ?? 0);
    this.block_.childlessWidth = this.hatSize.width;
  }
}

class PathObject extends Blockly.zelos.PathObject {
  private gradient?: SVGLinearGradientElement;

  applyColour(block: Blockly.BlockSvg) {
    super.applyColour(block);
    if (block.isShadow() || block.isInsertionMarker()) return;
    if (!this.gradient) {
      const ns = "http://www.w3.org/2000/svg";
      this.gradient = document.createElementNS(ns, "linearGradient");
      this.gradient.id = `bark-block-${Blockly.utils.idGenerator.genUid().replace(/[^a-zA-Z0-9]/g, "")}`;
      this.gradient.setAttribute("x2", "0");
      this.gradient.setAttribute("y2", "1");
      for (const offset of ["0", ".2", "1"]) {
        const stop = document.createElementNS(ns, "stop");
        stop.setAttribute("offset", offset);
        this.gradient.appendChild(stop);
      }
      this.svgRoot.prepend(this.gradient);
    }
    const color = block.getColour();
    const stops = this.gradient.children;
    stops[0].setAttribute(
      "stop-color",
      `color-mix(in srgb, ${color} 75%, white)`,
    );
    stops[1].setAttribute("stop-color", color);
    stops[2].setAttribute(
      "stop-color",
      `color-mix(in srgb, ${color} 94%, black)`,
    );
    this.svgPath.setAttribute("fill", `url(#${this.gradient.id})`);
    this.svgPath.setAttribute(
      "stroke",
      `color-mix(in srgb, ${color} 78%, white)`,
    );
    this.svgPath.setAttribute("stroke-width", "1");
  }
}

export class BarkRenderer extends Blockly.zelos.Renderer {
  protected makeConstants_() {
    return new Constants();
  }
  protected makeDrawer_(
    block: Blockly.BlockSvg,
    info: Blockly.blockRendering.RenderInfo,
  ) {
    return new Drawer(block, info as Blockly.zelos.RenderInfo);
  }
  makePathObject(root: SVGElement, style: Blockly.Theme.BlockStyle) {
    return new PathObject(root, style, this.getConstants());
  }
  static registered = false;
  static register() {
    if (this.registered) return;
    Blockly.blockRendering.register("bark", BarkRenderer);
    const flag =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M5 29V4" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M6 5C12 1 18 8 27 5V21C19 24 13 17 6 21Z" fill="white"/></svg>',
      );
    for (const name of [
      "bark_start",
      "bark_input_event",
      "bark_touch",
      "bark_interact",
    ]) {
      const definition = Blockly.Blocks[name];
      const init = definition.init;
      definition.init = function (this: Blockly.Block) {
        init.call(this);
        for (const field of this.inputList[0].fieldRow) {
          if (field.getValue() === "when input") field.setValue("when");
          if (field.getValue() === "touches something")
            field.setValue("is touched");
        }
        this.inputList[0].insertFieldAt(
          0,
          new Blockly.FieldImage(flag, 28, 28, ""),
        );
      };
    }
    const entity = Blockly.Blocks.bark_entity.init;
    Blockly.Blocks.bark_entity.init = function (this: Blockly.Block) {
      entity.call(this);
      this.inputList[0].fieldRow[0].setValue("");
    };
    this.registered = true;
  }
}
