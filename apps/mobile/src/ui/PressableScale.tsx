import {useRef} from 'react';
import type {ReactNode} from 'react';
import {Animated,Pressable} from 'react-native';
import type {PressableProps,StyleProp,ViewStyle} from 'react-native';

/** A press that answers the finger: a short spring to 96 % and back. Disabled presses stay still. */
export function PressableScale({children,style,disabled,...props}:Omit<PressableProps,'style'|'children'>&{children:ReactNode;style?:StyleProp<ViewStyle>}){
  const scale=useRef(new Animated.Value(1)).current;
  const to=(value:number)=>Animated.spring(scale,{toValue:value,useNativeDriver:true,speed:40,bounciness:value===1?7:0}).start();
  return <Pressable {...props} disabled={disabled} onPressIn={e=>{if(!disabled)to(.96);props.onPressIn?.(e);}} onPressOut={e=>{to(1);props.onPressOut?.(e);}}>
    <Animated.View style={[style,{transform:[{scale}]}]}>{children}</Animated.View>
  </Pressable>;
}
