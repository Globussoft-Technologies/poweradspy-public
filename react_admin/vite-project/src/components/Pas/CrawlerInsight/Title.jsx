import React from 'react'
import { FiInfo } from 'react-icons/fi';

const Title = ({className,title,tooltipText}) => {

    
  return (
    <div className={className}>
    <div>{title}</div>
    <div className="relative group ml-3">
      <FiInfo className="cursor-pointer" />

      <div className="absolute bottom-full mb-2 hidden group-hover:block border-[#264688] border-1 text-[#264688] text-xs rounded px-2 py-1 whitespace-nowrap z-10">
        {tooltipText}
      </div>
    </div>
    
  </div>
  )
}

export default Title
