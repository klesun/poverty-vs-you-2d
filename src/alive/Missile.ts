
import {IAlive} from "./IAlive";
import DisplayObject = createjs.DisplayObject;
import {rect_t} from "../MokonaGame";

const BOUNDS: rect_t = [0,0,50,10];
const MAX_VX = 15;

/** missile is (at least for now) a ball casted by
 * an IPerson, flying by a straight line, that
 * explodes and damages another IPerson on contact */
export function Missile(x: number, y: number, vx: number, vy: number): IMissile
{
    var isDead = false;

    var makeShape = function(): DisplayObject
    {
        var shape = new createjs.Shape();

        var [dx,dy,w,h] = BOUNDS;
        shape.graphics
            .beginFill('#ff0').drawRect(dx,dy,w,h);

        shape.x = x;
        shape.y = y;

        return shape;
    };
    var shape = makeShape();

    var live = function()
    {
        shape.x += vx;
        shape.y += vy;

        vx = Math.max(-MAX_VX, Math.min(vx * 1.075, MAX_VX));

        if (shape.x > 1000 || shape.x < 0 || shape.y > 500 || shape.y < 0) {
            isDead = true;
        }
    };

    var interactWith = function(other: IAlive, prevPos: [number, number])
    {
        isDead = true;
        other.takeDamage(40);
    };

    return {
        getShape: () => shape,
        live: live,
        isDead: () => isDead,
        producedChildren: [],
        getBounds: () => BOUNDS,
        interactWith: interactWith,
        takeDamage: () => isDead = true,
        getVector: () => [vx, vy],
    };
}

export interface IMissile extends IAlive {

}